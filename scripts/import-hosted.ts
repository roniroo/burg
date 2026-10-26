/**
 * Bring a city home: copy one account's cities from the hosted Supabase
 * project into the desktop app's database.
 *
 *   npm run import:hosted -- --email you@example.com --dry-run
 *   npm run import:hosted -- --email you@example.com
 *
 * Options:
 *   --email <address>   whose cities to copy (required)
 *   --data-dir <path>   where to write; defaults to the desktop app's database,
 *                       ~/Library/Application Support/Burg/data
 *   --replace           allowed to wipe what is already there (the demo city a
 *                       first launch founds, or an earlier import)
 *   --dry-run           read the hosted side and report counts; write nothing
 *
 * It only ever *reads* the hosted project -- through its REST API, with the
 * service-role key in .env.local, because one person's rows span tables that
 * RLS would otherwise filter. The hosted city is left exactly as it was, so
 * the import can be re-run with --replace as often as needed, and the hosted
 * project should stay until the copy has been opened and checked.
 *
 * Quit Burg first: PGlite lets one process open a data directory at a time.
 *
 * The person keeps their hosted user id, so every owner_id and user_id in the
 * copied rows already points at them. Rows are written in one transaction
 * with triggers off (`session_replication_role = replica`), the way a restore
 * is done: road staleness, the profile trigger and the foreign-key checks are
 * all triggers, and they would otherwise fire on half-copied data. Foreign
 * keys are then checked explicitly, before the transaction commits.
 */
import { execFileSync } from "node:child_process";
import { homedir } from "node:os";
import path from "node:path";
import { config } from "dotenv";
import { PostgrestClient } from "@supabase/postgrest-js";
import type { PGlite, Transaction } from "@electric-sql/pglite";
import { openDatabase } from "../lib/db/open";

config({ path: ".env.local", quiet: true });

const args = process.argv.slice(2);
const option = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? undefined : args[i + 1];
};
const email = option("email")?.toLowerCase();
const dataDir = option("data-dir") ?? path.join(homedir(), "Library", "Application Support", "Burg", "data");
const replace = args.includes("--replace");
const dryRun = args.includes("--dry-run");

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!email) fail("Usage: npm run import:hosted -- --email you@example.com [--dry-run] [--replace]");
if (!url || !key) fail("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be in .env.local.");

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

/** Tables with nothing to carry over: sharing and billing do not exist here,
    and the sprite library never existed there. */
const SKIPPED = new Set(["city_invites", "subscriptions", "custom_sprites"]);

/** Columns added after the move, which the hosted schema does not have. */
const LOCAL_ONLY_COLUMNS: Record<string, string[]> = { buildings: ["custom_sprite_id"] };

// --- 1. Who, on the hosted side ---------------------------------------------

type HostedUser = { id: string; email?: string; created_at: string; user_metadata?: Record<string, unknown> };

async function findHostedUser(): Promise<HostedUser> {
  for (let page = 1; ; page++) {
    const response = await fetch(`${url}/auth/v1/admin/users?page=${page}&per_page=1000`, {
      headers: { apikey: key!, Authorization: `Bearer ${key}` },
    });
    if (!response.ok) fail(`Could not list hosted users: ${response.status} ${await response.text()}`);
    const { users } = (await response.json()) as { users: HostedUser[] };
    const found = users.find((u) => u.email?.toLowerCase() === email);
    if (found) return found;
    if (users.length < 1000) fail(`No hosted user with the address ${email}.`);
  }
}

const hosted = new PostgrestClient(`${url}/rest/v1`, {
  headers: { apikey: key!, Authorization: `Bearer ${key}` },
});

// --- 2. What the schema looks like, from the local copy of it ---------------

type Column = { name: string; type: string };
type Table = { name: string; columns: Column[]; primaryKey: string[] };

async function describeTables(db: PGlite): Promise<Table[]> {
  const { rows } = await db.query<{ table_name: string; columns: Column[]; primary_key: string[] | null }>(`
    select
      c.relname as table_name,
      json_agg(json_build_object('name', a.attname, 'type', format_type(a.atttypid, a.atttypmod)) order by a.attnum)
        filter (where a.attgenerated = '') as columns,
      (select array_agg(pa.attname::text order by k.ord)
         from pg_constraint con
         cross join unnest(con.conkey) with ordinality as k(attnum, ord)
         join pg_attribute pa on pa.attrelid = con.conrelid and pa.attnum = k.attnum
        where con.conrelid = c.oid and con.contype = 'p') as primary_key
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
    where n.nspname = 'public' and c.relkind = 'r'
    group by c.oid, c.relname
    order by c.relname
  `);
  return rows.map((r) => ({
    name: r.table_name,
    columns: r.columns.filter((c) => !LOCAL_ONLY_COLUMNS[r.table_name]?.includes(c.name)),
    primaryKey: r.primary_key ?? [],
  }));
}

/**
 * The hosted select for a table: every stored column, with bigint and numeric
 * read as text. PostgREST sends them as JSON numbers, and a number past 2^53
 * would come back from JSON.parse as a different number.
 */
function selectFor(table: Table): string {
  return table.columns
    .map((c) => (c.type === "bigint" || c.type.startsWith("numeric") ? `${c.name}::text` : c.name))
    .join(",");
}

/** Every row a filter matches, a page at a time (the hosted API caps a response at 1000). */
async function fetchAll(
  table: Table,
  filter: (q: ReturnType<ReturnType<typeof hosted.from>["select"]>) => typeof q,
): Promise<Record<string, unknown>[]> {
  const rows: Record<string, unknown>[] = [];
  for (let from = 0; ; from += 1000) {
    let query = filter(hosted.from(table.name).select(selectFor(table)));
    for (const key of table.primaryKey) query = query.order(key);
    const { data, error } = await query.range(from, from + 999);
    if (error) fail(`Reading ${table.name} from the hosted project failed: ${error.message}`);
    rows.push(...((data ?? []) as unknown as Record<string, unknown>[]));
    if ((data ?? []).length < 1000) return rows;
  }
}

// --- 3. Copy ------------------------------------------------------------------

function burgIsRunning(): boolean {
  try {
    execFileSync("pgrep", ["-f", "Burg.app/Contents/MacOS/Burg"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

async function insertRows(tx: Transaction, table: Table, rows: Record<string, unknown>[]): Promise<void> {
  if (rows.length === 0) return;
  const list = table.columns.map((c) => `"${c.name}"`).join(", ");
  const target = `public."${table.name}"`;
  for (let i = 0; i < rows.length; i += 500) {
    await tx.query(
      `insert into ${target} (${list}) select ${list} from json_populate_recordset(null::${target}, $1::json)`,
      [JSON.stringify(rows.slice(i, i + 500))],
    );
  }
}

/** Rows whose foreign key points at nothing, per constraint. Replica mode did not check them. */
async function danglingKeys(tx: Transaction): Promise<string[]> {
  const { rows: keys } = await tx.query<{ name: string; child: string; parent: string; cols: string[]; refs: string[] }>(`
    select con.conname as name,
           format('%I.%I', cn.nspname, c.relname) as child,
           format('%I.%I', pn.nspname, p.relname) as parent,
           array(select format('%I', a.attname) from unnest(con.conkey) with ordinality k(n, o)
                 join pg_attribute a on a.attrelid = con.conrelid and a.attnum = k.n order by k.o) as cols,
           array(select format('%I', a.attname) from unnest(con.confkey) with ordinality k(n, o)
                 join pg_attribute a on a.attrelid = con.confrelid and a.attnum = k.n order by k.o) as refs
    from pg_constraint con
    join pg_class c on c.oid = con.conrelid join pg_namespace cn on cn.oid = c.relnamespace
    join pg_class p on p.oid = con.confrelid join pg_namespace pn on pn.oid = p.relnamespace
    where con.contype = 'f' and cn.nspname = 'public'
  `);

  const problems: string[] = [];
  for (const k of keys) {
    const present = k.cols.map((c) => `c.${c} is not null`).join(" and ");
    const joined = k.cols.map((c, i) => `p.${k.refs[i]} = c.${c}`).join(" and ");
    const { rows } = await tx.query<{ n: number }>(
      `select count(*)::int as n from ${k.child} c where ${present} and not exists (select 1 from ${k.parent} p where ${joined})`,
    );
    if ((rows[0]?.n ?? 0) > 0) problems.push(`${k.name}: ${rows[0]!.n} rows`);
  }
  return problems;
}

async function main() {
  if (!dryRun && burgIsRunning()) fail("Burg is open. Quit it first -- only one process can open its database.");

  const user = await findHostedUser();
  console.log(`Hosted account: ${user.email} (${user.id})`);

  // Opening also creates the directory and applies every migration.
  const db = await openDatabase(dryRun ? undefined : dataDir);
  try {
    const tables = (await describeTables(db)).filter((t) => !SKIPPED.has(t.name));
    const byName = new Map(tables.map((t) => [t.name, t]));
    const need = (name: string) => byName.get(name) ?? fail(`The local schema has no ${name} table.`);

    const cities = await fetchAll(need("cities"), (q) => q.eq("owner_id", user.id));
    const cityIds = cities.map((c) => String(c.id));
    if (cityIds.length === 0) fail(`${user.email} owns no city on the hosted project.`);
    console.log(`Cities: ${cities.map((c) => c.name).join(", ")}`);

    const copied = new Map<string, Record<string, unknown>[]>();
    copied.set("cities", cities);
    copied.set("profiles", await fetchAll(need("profiles"), (q) => q.eq("id", user.id)));
    // Only the owner's own membership: anyone else in a shared city has no
    // account on this machine for the row to point at.
    copied.set(
      "city_members",
      await fetchAll(need("city_members"), (q) => q.in("city_id", cityIds).eq("user_id", user.id)),
    );

    for (const table of tables) {
      if (copied.has(table.name)) continue;
      if (!table.columns.some((c) => c.name === "city_id")) {
        fail(`Do not know how to scope ${table.name} to a city; teach the import about it.`);
      }
      copied.set(table.name, await fetchAll(table, (q) => q.in("city_id", cityIds)));
    }

    // The activity ticker remembers who did what; on this machine there is
    // only one who, so headlines from collaborators keep their text and lose
    // the pointer.
    for (const row of copied.get("activity") ?? []) {
      if (row.actor_id && row.actor_id !== user.id) row.actor_id = null;
    }

    const width = Math.max(...[...copied.keys()].map((k) => k.length));
    for (const [name, rows] of [...copied].sort()) console.log(`  ${name.padEnd(width)}  ${rows.length}`);

    if (dryRun) {
      console.log("\nDry run: nothing was written.");
      return;
    }

    const { rows: before } = await db.query<{ users: number; cities: number }>(
      "select (select count(*) from auth.users)::int as users, (select count(*) from public.cities)::int as cities",
    );
    if ((before[0]!.users > 0 || before[0]!.cities > 0) && !replace) {
      fail(
        `${dataDir} already holds ${before[0]!.cities} cities and ${before[0]!.users} owner(s) ` +
          "(the demo city a first launch founds, or an earlier import). Re-run with --replace to wipe it.",
      );
    }

    await db.transaction(async (tx) => {
      // With triggers on, so the cascades clear everything hanging off them.
      await tx.exec("delete from public.cities; delete from auth.users;");

      await tx.exec("set local session_replication_role = replica");
      await tx.query("insert into auth.users (id, email, raw_user_meta_data, created_at) values ($1, $2, $3, $4)", [
        user.id,
        user.email ?? null,
        user.user_metadata ?? {},
        user.created_at,
      ]);
      for (const [name, rows] of copied) await insertRows(tx, need(name), rows);

      const problems = await danglingKeys(tx);
      if (problems.length > 0) {
        throw new Error(`The copy has rows pointing at nothing, so it was not saved:\n  ${problems.join("\n  ")}`);
      }

      for (const [name, rows] of copied) {
        const { rows: counted } = await tx.query<{ n: number }>(`select count(*)::int as n from public."${name}"`);
        if (counted[0]!.n !== rows.length) {
          throw new Error(`${name}: read ${rows.length} rows but ${counted[0]!.n} are there; not saved.`);
        }
      }
    });

    console.log(`\nImported into ${dataDir}. Every count matches and every foreign key resolves.`);
  } finally {
    await db.close();
  }
}

main().catch((error: unknown) => fail(error instanceof Error ? error.message : String(error)));
