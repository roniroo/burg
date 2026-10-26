import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { PostgrestClient } from "@supabase/postgrest-js";
import { restHandler } from "./rest";
import { clientFor } from "./client";
import { openDatabase } from "./open";
import { seedIdeaburg } from "@/lib/seed/ideaburg";

/**
 * The local PostgREST is checked the way the app uses it: through
 * postgrest-js, so a request the client builds that the translator mishears
 * fails here rather than in a page.
 */

const SCHEMA = `
  create type colour as enum ('red', 'blue');
  create table owners (
    id uuid primary key default gen_random_uuid(),
    name text not null,
    created_at timestamptz not null default '2026-01-02T03:04:05Z'
  );
  create table things (
    id uuid primary key default gen_random_uuid(),
    owner_id uuid references owners (id) on delete cascade,
    title text not null,
    colour colour not null default 'red',
    position int not null default 0,
    data jsonb not null default '{}',
    unique (owner_id, title)
  );
  create table points (id int primary key, x int not null, y int not null, e1 text);
  insert into points values (1, 3, 4, 'a'), (2, 5, 6, 'b');
  create table links (
    id serial primary key,
    from_id uuid not null references things (id) on delete cascade,
    to_id uuid not null references things (id) on delete cascade
  );
  create function count_things(target uuid) returns integer
    language sql stable as $$ select count(*)::int from things where owner_id = target $$;
  create function things_of(target uuid) returns table (id uuid, title text)
    language sql stable as $$ select id, title from things where owner_id = target order by position $$;
`;

const ADA = "00000000-0000-4000-8000-00000000000a";
const BEA = "00000000-0000-4000-8000-00000000000b";
const ONE = "00000000-0000-4000-8000-000000000001";
const TWO = "00000000-0000-4000-8000-000000000002";
const THREE = "00000000-0000-4000-8000-000000000003";

describe("local PostgREST", () => {
  let db: PGlite;
  let client: PostgrestClient;

  beforeAll(async () => {
    db = await PGlite.create();
    await db.exec("set timezone to 'UTC'");
    await db.exec(SCHEMA);
    await db.exec(`
      insert into owners (id, name) values ('${ADA}', 'Ada'), ('${BEA}', 'Bea');
      insert into things (id, owner_id, title, colour, position, data) values
        ('${ONE}', '${ADA}', 'Lamp', 'red', 2, '{"watts": 40}'),
        ('${TWO}', '${ADA}', 'Desk, oak', 'blue', 1, '{}'),
        ('${THREE}', null, 'Stray', 'blue', 0, '{}');
      insert into links (from_id, to_id) values ('${ONE}', '${TWO}');
    `);
    const handle = restHandler(db);
    client = new PostgrestClient("http://burg.local/rest/v1", {
      fetch: (input, init) => handle(new Request(input, init)),
    });
  });

  afterAll(() => db.close());

  it("selects columns, filters and orders", async () => {
    const { data, error } = await client
      .from("things")
      .select("title, position")
      .eq("owner_id", ADA)
      .order("position");
    expect(error).toBeNull();
    expect(data).toEqual([
      { title: "Desk, oak", position: 1 },
      { title: "Lamp", position: 2 },
    ]);
  });

  it("returns whole rows even when a column shares a name with an internal alias", async () => {
    // `tiles` has an `x` column; this once came back as [3, 5].
    const { data } = await client.from("points").select("x, y, e1").order("id");
    expect(data).toEqual([
      { x: 3, y: 4, e1: "a" },
      { x: 5, y: 6, e1: "b" },
    ]);
    const written = await client.from("points").insert({ id: 3, x: 7, y: 8 }).select("x, y").single();
    expect(written.data).toEqual({ x: 7, y: 8 });
  });

  it("aliases and casts columns", async () => {
    const { data } = await client.from("things").select("name:title, position::text").eq("id", ONE);
    expect(data).toEqual([{ name: "Lamp", position: "2" }]);
  });

  it("returns jsonb as JSON and timestamps as PostgREST spells them", async () => {
    const thing = await client.from("things").select("data").eq("id", ONE).single();
    expect(thing.data).toEqual({ data: { watts: 40 } });
    const owner = await client.from("owners").select("created_at").eq("id", ADA).single();
    expect(owner.data).toEqual({ created_at: "2026-01-02T03:04:05+00:00" });
  });

  it("embeds the row a foreign key points at as an object", async () => {
    const { data } = await client.from("things").select("title, owners(name)").order("position");
    expect(data).toEqual([
      { title: "Stray", owners: null },
      { title: "Desk, oak", owners: { name: "Ada" } },
      { title: "Lamp", owners: { name: "Ada" } },
    ]);
  });

  it("embeds the rows pointing back as an array", async () => {
    const { data } = await client.from("owners").select("name, things(title)").order("name");
    expect(data).toEqual([
      { name: "Ada", things: expect.arrayContaining([{ title: "Lamp" }, { title: "Desk, oak" }]) },
      { name: "Bea", things: [] },
    ]);
  });

  it("needs a hint when two keys join the same tables, and follows it", async () => {
    const ambiguous = await client.from("links").select("id, things(title)");
    expect(ambiguous.error?.code).toBe("PGRST201");

    const { data, error } = await client
      .from("links")
      .select("from:things!links_from_id_fkey(title), to:things!links_to_id_fkey(title)");
    expect(error).toBeNull();
    expect(data).toEqual([{ from: { title: "Lamp" }, to: { title: "Desk, oak" } }]);
  });

  it("understands each filter the app and the checks use", async () => {
    const titles = async (q: PromiseLike<{ data: Array<{ title: string }> | null }>) =>
      ((await q).data ?? []).map((t) => t.title).sort();

    const all = () => client.from("things").select("title");
    expect(await titles(all().neq("colour", "red"))).toEqual(["Desk, oak", "Stray"]);
    expect(await titles(all().in("title", ["Lamp", "Desk, oak"]))).toEqual(["Desk, oak", "Lamp"]);
    expect(await titles(all().in("title", []))).toEqual([]);
    expect(await titles(all().is("owner_id", null))).toEqual(["Stray"]);
    expect(await titles(all().not("owner_id", "is", null))).toEqual(["Desk, oak", "Lamp"]);
    expect(await titles(all().gt("position", 0).lte("position", 1))).toEqual(["Desk, oak"]);
    expect(await titles(all().ilike("title", "%DESK%"))).toEqual(["Desk, oak"]);
    expect(await titles(all().match({ owner_id: ADA, colour: "red" }))).toEqual(["Lamp"]);
    expect(await titles(all().or(`id.eq.${ONE},id.eq.${THREE}`))).toEqual(["Lamp", "Stray"]);
  });

  it("limits, offsets and counts", async () => {
    const page = await client.from("things").select("title").order("position").range(1, 1);
    expect(page.data).toEqual([{ title: "Desk, oak" }]);

    const head = await client.from("things").select("*", { count: "exact", head: true }).eq("owner_id", ADA);
    expect(head.count).toBe(2);
    expect(head.data).toBeNull();
  });

  it("holds single() and maybeSingle() to one row", async () => {
    const none = await client.from("things").select("id").eq("title", "Nope").maybeSingle();
    expect(none).toMatchObject({ data: null, error: null });

    const many = await client.from("things").select("id").eq("owner_id", ADA).maybeSingle();
    expect(many.error?.code).toBe("PGRST116");

    const missing = await client.from("things").select("id").eq("title", "Nope").single();
    expect(missing.error?.code).toBe("PGRST116");
    expect(missing.status).toBe(406);
  });

  it("inserts, returning only when asked", async () => {
    const quiet = await client.from("owners").insert({ name: "Cy" });
    expect(quiet).toMatchObject({ data: null, error: null, status: 201 });

    const { data, error } = await client
      .from("things")
      .insert({ owner_id: BEA, title: "Kettle", data: { litres: 1.5 } })
      .select("title, colour, data, owners(name)")
      .single();
    expect(error).toBeNull();
    expect(data).toEqual({ title: "Kettle", colour: "red", data: { litres: 1.5 }, owners: { name: "Bea" } });

    const bulk = await client
      .from("things")
      .insert([
        { owner_id: BEA, title: "Mug", position: 5 },
        { owner_id: BEA, title: "Spoon", position: 6 },
      ])
      .select("title");
    expect(bulk.data).toEqual([{ title: "Mug" }, { title: "Spoon" }]);
  });

  it("reports constraint violations with their SQLSTATE", async () => {
    const { error, status } = await client.from("things").insert({ owner_id: ADA, title: "Lamp" });
    expect(error?.code).toBe("23505");
    expect(status).toBe(409);

    const bad = await client.from("things").insert({ owner_id: ADA, title: "x", colour: "green" });
    expect(bad.error?.code).toBe("22P02");
  });

  it("upserts by merging or by ignoring", async () => {
    await client
      .from("things")
      .upsert({ owner_id: ADA, title: "Lamp", position: 9 }, { onConflict: "owner_id,title" });
    const merged = await client.from("things").select("position").eq("id", ONE).single();
    expect(merged.data).toEqual({ position: 9 });

    await client
      .from("things")
      .upsert({ owner_id: ADA, title: "Lamp", position: 1 }, { onConflict: "owner_id,title", ignoreDuplicates: true });
    const kept = await client.from("things").select("position").eq("id", ONE).single();
    expect(kept.data).toEqual({ position: 9 });
  });

  it("updates and deletes only what the filters match", async () => {
    const updated = await client.from("things").update({ colour: "red" }).eq("id", TWO).select("title, colour");
    expect(updated.data).toEqual([{ title: "Desk, oak", colour: "red" }]);
    const untouched = await client.from("things").select("colour").eq("id", THREE).single();
    expect(untouched.data).toEqual({ colour: "blue" });

    const quiet = await client.from("links").delete().eq("from_id", ONE);
    expect(quiet).toMatchObject({ error: null, status: 204 });
    const left = await client.from("links").select("id", { count: "exact", head: true });
    expect(left.count).toBe(0);
  });

  it("calls functions with named arguments", async () => {
    const scalar = await client.rpc("count_things", { target: ADA });
    expect(scalar.data).toBe(2);

    const set = await client.rpc("things_of", { target: ADA });
    expect(set.data).toEqual([
      { id: TWO, title: "Desk, oak" },
      { id: ONE, title: "Lamp" },
    ]);
  });

  it("refuses names that are not in the schema", async () => {
    expect((await client.from("nope").select("*")).error?.code).toBe("42P01");
    expect((await client.from("things").select("nope")).error?.code).toBe("42703");
    expect((await client.from("things").select("title").eq('title"; drop table things; --', "x")).error?.code).toBe(
      "42703",
    );
  });
});

describe("the real schema", () => {
  let db: PGlite;

  beforeAll(async () => {
    db = await openDatabase();
  }, 60_000);

  afterAll(() => db.close());

  it("seeds Ideaburg through the client and keeps its constraints", async () => {
    const { rows } = await db.query<{ id: string }>(
      "insert into auth.users (email) values ('you@burg.local') returning id",
    );
    const owner = rows[0]!.id;
    const client = clientFor(db);

    const seeded = await seedIdeaburg(client, owner);
    expect(seeded.created).toBe(true);
    expect((await seedIdeaburg(client, owner)).created).toBe(false);

    const buildings = await client.from("buildings").select("*", { count: "exact", head: true });
    expect(buildings.count).toBe(8);

    // The road solver and the map read terrain like this; the river must be in it.
    const { data: tiles } = await client.from("tiles").select("x, y, terrain").eq("city_id", seeded.cityId);
    expect(tiles?.filter((t) => t.terrain === "water")).toHaveLength(80);
    expect(tiles?.[0]).toEqual({ x: expect.any(Number), y: expect.any(Number), terrain: expect.any(String) });

    const hits = await client.rpc("search_all", { p_city_id: seeded.cityId, p_query: "launch" });
    expect(hits.error).toBeNull();
    expect((hits.data ?? []).length).toBeGreaterThan(0);

    // Overlapping footprints are the exclusion constraint's job, not RLS's.
    // One tile over, so the origin's unique index is not what refuses it.
    const { data: lot } = await client
      .from("buildings")
      .select("neighborhood_id, tile_x, tile_y, footprint_w, footprint_h, sprite_key")
      .gt("footprint_w", 1)
      .limit(1)
      .single();
    const clash = await client.from("buildings").insert({
      ...lot!,
      tile_x: lot!.tile_x + 1,
      city_id: seeded.cityId,
      title: "Squatter",
      artifact_type: "doc",
    });
    expect(clash.error?.code).toBe("23P01");
  }, 60_000);
});
