import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/database.types";
import {
  ACTIVITY_HEADLINES,
  LAUNCH_BRIEF_CHECKLIST,
  LAUNCH_BRIEF_PARAGRAPHS,
  PINEGROVE_PARAGRAPHS,
  READING_NOTES_PARAGRAPHS,
  RECIPES_PARAGRAPHS,
} from "./content";

type Client = SupabaseClient<Database>;

export type SeedResult = { cityId: string; created: boolean };

const CITY_SLUG = "ideaburg";
const CITY_W = 40;
const CITY_H = 40;

/** The river that the Harbor -> Old Town highway has to bridge. */
const RIVER_X = [17, 18];

/* -------------------------------------------------------------------------
   TipTap document builders
   ------------------------------------------------------------------------- */

type Node = { type: string; attrs?: Record<string, Json>; content?: Node[]; text?: string };

const heading = (level: number, text: string): Node => ({
  type: "heading",
  attrs: { level },
  content: [{ type: "text", text }],
});

const para = (text: string): Node => ({
  type: "paragraph",
  content: [{ type: "text", text }],
});

/**
 * A paragraph that ends with an inline reference to another building. This is
 * the node the map turns into a road, so the seed uses the real node name the
 * Phase 2 editor will register.
 */
const paraWithLink = (text: string, buildingId: string, label: string): Node => ({
  type: "paragraph",
  content: [
    { type: "text", text },
    { type: "buildingLink", attrs: { buildingId, label } },
  ],
});

const checklist = (items: ReadonlyArray<{ text: string; checked: boolean }>): Node => ({
  type: "taskList",
  content: items.map((item) => ({
    type: "taskItem",
    attrs: { checked: item.checked },
    content: [para(item.text)],
  })),
});

const doc = (content: Node[]): Node => ({ type: "doc", content });

/** Plain-text mirror of a document, used for full-text search. */
function plaintext(node: Node): string {
  if (node.text) return node.text;
  return (node.content ?? []).map(plaintext).join(" ");
}

/* -------------------------------------------------------------------------
   Seeder
   ------------------------------------------------------------------------- */

/**
 * Build the demo city "Ideaburg" for a user.
 *
 * Idempotent: if the user already owns a city with this slug the function
 * returns immediately. Safe to run as the signed-in user -- the insert order
 * (city, then membership, then everything else) satisfies RLS at every step,
 * so no service-role key is required.
 */
export async function seedIdeaburg(supabase: Client, userId: string): Promise<SeedResult> {
  const existing = await supabase
    .from("cities")
    .select("id")
    .eq("owner_id", userId)
    .eq("slug", CITY_SLUG)
    .maybeSingle();

  if (existing.error) throw existing.error;
  if (existing.data) return { cityId: existing.data.id, created: false };

  // Ids are generated up front: the city row is not readable until the
  // membership row exists, so `.insert().select()` cannot be used for it.
  const cityId = crypto.randomUUID();
  const harborId = crypto.randomUUID();
  const oldTownId = crypto.randomUUID();
  const pinegroveId = crypto.randomUUID();

  const launchBriefId = crypto.randomUUID();
  const roadmapId = crypto.randomUUID();
  const harborBoardId = crypto.randomUUID();
  const referencesId = crypto.randomUUID();
  const readingNotesId = crypto.randomUUID();
  const recipesId = crypto.randomUUID();
  const oldTownBoardId = crypto.randomUUID();
  const fieldNotesId = crypto.randomUUID();

  const fail = (step: string) => (error: { message: string } | null) => {
    if (error) throw new Error(`seed failed at ${step}: ${error.message}`);
  };

  // Everything from here is wrapped: a half-built city is worse than no city
  // at all, because the idempotency guard above would treat it as finished.
  // Postgres has no transaction across separate PostgREST calls, so on any
  // failure the city row is deleted and the cascade takes the rest with it.
  try {
  // --- city + membership --------------------------------------------------
  fail("cities")(
    (
      await supabase.from("cities").insert({
        id: cityId,
        owner_id: userId,
        name: "Ideaburg",
        slug: CITY_SLUG,
        width: CITY_W,
        height: CITY_H,
        seed: 20260904,
      })
    ).error,
  );

  fail("city_members")(
    (await supabase.from("city_members").insert({ city_id: cityId, user_id: userId, role: "owner" })).error,
  );

  // --- neighbourhoods -----------------------------------------------------
  fail("neighborhoods")(
    (
      await supabase.from("neighborhoods").insert([
        {
          id: harborId,
          city_id: cityId,
          name: "Harbor District",
          slug: "harbor-district",
          description: "A product launch, currently mid-build.",
          biome: "harbor",
          status: "building",
          crest_sprite: "crest_anchor",
          origin_x: 2,
          origin_y: 2,
          width: 12,
          height: 10,
          position: 0,
        },
        {
          id: oldTownId,
          city_id: cityId,
          name: "Old Town",
          slug: "old-town",
          description: "A personal wiki: reading, cooking, and loose ends.",
          biome: "downtown",
          status: "planning",
          crest_sprite: "crest_clock",
          origin_x: 20,
          origin_y: 4,
          width: 12,
          height: 10,
          position: 1,
        },
        {
          id: pinegroveId,
          city_id: cityId,
          name: "Pinegrove",
          slug: "pinegrove",
          description: "A generative-maps side project, stopped rather than failed.",
          biome: "forest",
          status: "archived",
          crest_sprite: "crest_pine",
          origin_x: 6,
          origin_y: 20,
          width: 10,
          height: 8,
          position: 2,
        },
      ])
    ).error,
  );

  // --- terrain ------------------------------------------------------------
  const tiles: Database["public"]["Tables"]["tiles"]["Insert"][] = [];

  for (const [id, ox, oy, w, h, ground] of [
    [harborId, 2, 2, 12, 10, "cobble"],
    [oldTownId, 20, 4, 12, 10, "cobble"],
    [pinegroveId, 6, 20, 10, 8, "park"],
  ] as const) {
    for (let x = ox; x < ox + w; x++) {
      for (let y = oy; y < oy + h; y++) {
        tiles.push({ city_id: cityId, x, y, terrain: ground, neighborhood_id: id });
      }
    }
  }

  for (const x of RIVER_X) {
    for (let y = 0; y < CITY_H; y++) {
      tiles.push({ city_id: cityId, x, y, terrain: "water", neighborhood_id: null });
    }
  }

  for (let i = 0; i < tiles.length; i += 500) {
    fail("tiles")((await supabase.from("tiles").insert(tiles.slice(i, i + 500))).error);
  }

  // --- buildings ----------------------------------------------------------
  fail("buildings")(
    (
      await supabase.from("buildings").insert([
        { id: launchBriefId, city_id: cityId, neighborhood_id: harborId, title: "Launch Brief", artifact_type: "doc", sprite_key: "library", sprite_variant: 1, tile_x: 3, tile_y: 3, footprint_w: 2, footprint_h: 2, floors: 2, position: 0 },
        { id: roadmapId, city_id: cityId, neighborhood_id: harborId, title: "Roadmap", artifact_type: "table", sprite_key: "warehouse", sprite_variant: 1, tile_x: 7, tile_y: 3, footprint_w: 2, footprint_h: 2, floors: 1, position: 1 },
        { id: harborBoardId, city_id: cityId, neighborhood_id: harborId, title: "Harbor Plaza Board", artifact_type: "board", sprite_key: "noticeboard", sprite_variant: 1, tile_x: 5, tile_y: 7, footprint_w: 1, footprint_h: 1, floors: 1, position: 2 },
        { id: referencesId, city_id: cityId, neighborhood_id: harborId, title: "References", artifact_type: "kiosk", sprite_key: "newsstand", sprite_variant: 1, tile_x: 10, tile_y: 8, footprint_w: 1, footprint_h: 1, floors: 1, position: 3 },

        { id: readingNotesId, city_id: cityId, neighborhood_id: oldTownId, title: "Reading Notes", artifact_type: "doc", sprite_key: "library", sprite_variant: 2, tile_x: 21, tile_y: 5, footprint_w: 2, footprint_h: 2, floors: 3, position: 0 },
        { id: recipesId, city_id: cityId, neighborhood_id: oldTownId, title: "Recipes", artifact_type: "doc", sprite_key: "library", sprite_variant: 3, tile_x: 25, tile_y: 5, footprint_w: 1, footprint_h: 1, floors: 2, position: 1 },
        { id: oldTownBoardId, city_id: cityId, neighborhood_id: oldTownId, title: "Old Town Board", artifact_type: "board", sprite_key: "noticeboard", sprite_variant: 2, tile_x: 23, tile_y: 9, footprint_w: 1, footprint_h: 1, floors: 1, position: 2 },

        { id: fieldNotesId, city_id: cityId, neighborhood_id: pinegroveId, title: "Terrain Notes", artifact_type: "doc", sprite_key: "library", sprite_variant: 1, tile_x: 8, tile_y: 22, footprint_w: 1, footprint_h: 1, floors: 1, position: 0 },
      ])
    ).error,
  );

  // --- gates --------------------------------------------------------------
  // Auto-placed on the sides facing the most-connected neighbours. Phase 5b
  // re-places these whenever a region moves; the seed just gives the router a
  // sensible starting pair per crossing.
  fail("gates")(
    (
      await supabase.from("gates").insert([
        { city_id: cityId, neighborhood_id: harborId, edge: "east", edge_offset: 5, tile_x: 13, tile_y: 7 },
        { city_id: cityId, neighborhood_id: harborId, edge: "south", edge_offset: 5, tile_x: 7, tile_y: 11 },
        { city_id: cityId, neighborhood_id: oldTownId, edge: "west", edge_offset: 5, tile_x: 20, tile_y: 9 },
        { city_id: cityId, neighborhood_id: pinegroveId, edge: "north", edge_offset: 5, tile_x: 11, tile_y: 20 },
      ])
    ).error,
  );

  // --- Launch Brief (doc) -------------------------------------------------
  const launchBriefDoc = doc([
    heading(1, "Launch Brief"),
    para(LAUNCH_BRIEF_PARAGRAPHS.intro),
    heading(2, "Scope"),
    para(LAUNCH_BRIEF_PARAGRAPHS.scope),
    heading(2, "Open items"),
    checklist(LAUNCH_BRIEF_CHECKLIST),
    heading(2, "Risks"),
    para(LAUNCH_BRIEF_PARAGRAPHS.risks),
    heading(2, "Cadence"),
    paraWithLink(`${LAUNCH_BRIEF_PARAGRAPHS.cadence} Per-item detail lives in `, roadmapId, "Roadmap"),
  ]);

  const readingNotesDoc = doc([
    heading(1, "Reading Notes"),
    ...READING_NOTES_PARAGRAPHS.map(para),
  ]);
  const recipesDoc = doc([heading(1, "Recipes"), ...RECIPES_PARAGRAPHS.map(para)]);
  const pinegroveDoc = doc([heading(1, "Terrain Notes"), ...PINEGROVE_PARAGRAPHS.map(para)]);

  fail("documents")(
    (
      await supabase.from("documents").insert([
        { building_id: launchBriefId, city_id: cityId, content: launchBriefDoc as unknown as Json, search_text: plaintext(launchBriefDoc) },
        { building_id: readingNotesId, city_id: cityId, content: readingNotesDoc as unknown as Json, search_text: plaintext(readingNotesDoc) },
        { building_id: recipesId, city_id: cityId, content: recipesDoc as unknown as Json, search_text: plaintext(recipesDoc) },
        { building_id: fieldNotesId, city_id: cityId, content: pinegroveDoc as unknown as Json, search_text: plaintext(pinegroveDoc) },
      ])
    ).error,
  );

  // --- Roadmap (data table) ----------------------------------------------
  const fieldIds = {
    title: crypto.randomUUID(),
    status: crypto.randomUUID(),
    owner: crypto.randomUUID(),
    target: crypto.randomUUID(),
    effort: crypto.randomUUID(),
    notes: crypto.randomUUID(),
  };

  fail("data_tables")(
    (await supabase.from("data_tables").insert({ building_id: roadmapId, city_id: cityId, name: "Roadmap" })).error,
  );

  fail("table_fields")(
    (
      await supabase.from("table_fields").insert([
        { id: fieldIds.title, city_id: cityId, building_id: roadmapId, name: "Title", field_type: "text", position: 0, width: 260, options: {} as unknown as Json },
        {
          id: fieldIds.status, city_id: cityId, building_id: roadmapId, name: "Status", field_type: "select", position: 1, width: 140,
          options: { choices: [
            { id: "planning", label: "Planning", color: 3 },
            { id: "building", label: "Building", color: 4 },
            { id: "shipped", label: "Shipped", color: 2 },
          ] } as unknown as Json,
        },
        { id: fieldIds.owner, city_id: cityId, building_id: roadmapId, name: "Owner", field_type: "person", position: 2, width: 140, options: {} as unknown as Json },
        { id: fieldIds.target, city_id: cityId, building_id: roadmapId, name: "Target", field_type: "date", position: 3, width: 130, options: {} as unknown as Json },
        { id: fieldIds.effort, city_id: cityId, building_id: roadmapId, name: "Effort", field_type: "number", position: 4, width: 90, options: {} as unknown as Json },
        { id: fieldIds.notes, city_id: cityId, building_id: roadmapId, name: "Notes", field_type: "long_text", position: 5, width: 320, options: {} as unknown as Json },
      ])
    ).error,
  );

  fail("data_tables.primary_field_id")(
    (await supabase.from("data_tables").update({ primary_field_id: fieldIds.title }).eq("building_id", roadmapId)).error,
  );

  const roadmapRows: ReadonlyArray<[string, string, string, string, number, string]> = [
    ["Freeze the ingest schema", "shipped", "Ren", "2026-08-14", 3, "Locked after the second cut. No further changes without a brief edit."],
    ["Reviewer queue v1", "building", "Ada", "2026-09-19", 8, "Still single-owner. This is the risk called out in the brief."],
    ["Status page skeleton", "building", "Ren", "2026-09-12", 5, "Vendor untested under load."],
    ["Rollback dry run", "planning", "Kit", "2026-09-26", 2, "Needs a staging window and one hour of everyone's attention."],
    ["Customer note draft", "shipped", "Mo", "2026-08-29", 1, "Approved; holding until the date is certain."],
    ["Ingest retries", "building", "Ada", "2026-09-16", 5, "Exponential backoff, cap at six attempts."],
    ["Queue latency dashboard", "planning", "Kit", "2026-10-03", 3, "Blocked on the status page vendor decision."],
    ["Partner API", "planning", "—", "2026-11-14", 13, "Explicitly out of scope for this launch. Listed so it stops being re-raised."],
    ["Mobile shell", "planning", "—", "2026-12-05", 13, "Out of scope. See above."],
    ["Billing changes", "planning", "—", "2026-12-19", 8, "Out of scope, and the least likely to sneak back in."],
    ["Load test harness", "building", "Ren", "2026-09-22", 5, "Reusable past the launch, which is why it survived the cut."],
    ["Launch comms plan", "planning", "Mo", "2026-09-30", 2, "One page, three audiences."],
  ];

  fail("table_rows")(
    (
      await supabase.from("table_rows").insert(
        roadmapRows.map(([title, status, owner, target, effort, notes], i) => ({
          city_id: cityId,
          building_id: roadmapId,
          position: i,
          search_text: title,
          data: {
            [fieldIds.title]: title,
            [fieldIds.status]: status,
            [fieldIds.owner]: owner,
            [fieldIds.target]: target,
            [fieldIds.effort]: effort,
            [fieldIds.notes]: notes,
          } as unknown as Json,
        })),
      )
    ).error,
  );

  fail("table_views")(
    (
      await supabase.from("table_views").insert([
        { city_id: cityId, building_id: roadmapId, name: "All items", view_type: "table", position: 0, group_by_field_id: null },
        { city_id: cityId, building_id: roadmapId, name: "By status", view_type: "board", position: 1, group_by_field_id: fieldIds.status },
      ])
    ).error,
  );

  // --- boards -------------------------------------------------------------
  fail("boards")(
    (
      await supabase.from("boards").insert([
        { building_id: harborBoardId, city_id: cityId, mode: "freeform" },
        { building_id: oldTownBoardId, city_id: cityId, mode: "freeform" },
      ])
    ).error,
  );

  const harborNotes: ReadonlyArray<[string, number, number, number, number]> = [
    ["Ask Ada who owns the reviewer queue when she is out", 1, 40, 48, -3],
    ["The status page vendor has a sandbox — use it", 2, 240, 72, 2],
    ["Rollback dry run needs a staging window", 3, 96, 200, -1],
    ["Someone should own the launch comms doc", 4, 340, 168, 4],
    ["Latency > 2s is a support problem, not an eng one", 5, 176, 320, -2],
    ["Do not let the partner API back into scope", 6, 420, 288, 3],
    ["Write the customer note before the date is fixed", 1, 60, 368, 1],
  ];

  const oldTownNotes: ReadonlyArray<[string, number, number, number, number]> = [
    ["Retrieval is spatial more often than semantic", 2, 64, 56, -2],
    ["Braises freeze better than anything else", 4, 280, 104, 3],
    ["A knowledge base is a graph pretending to be a tree", 5, 120, 232, -4],
    ["Try the shorter proof next time", 3, 320, 280, 2],
  ];

  fail("board_notes")(
    (
      await supabase.from("board_notes").insert([
        ...harborNotes.map(([body, color, x, y, rot], i) => ({
          city_id: cityId, building_id: harborBoardId, body, color, pin_x: x, pin_y: y, rotation: rot, position: i,
        })),
        ...oldTownNotes.map(([body, color, x, y, rot], i) => ({
          city_id: cityId, building_id: oldTownBoardId, body, color, pin_x: x, pin_y: y, rotation: rot, position: i,
        })),
      ])
    ).error,
  );

  // --- Newsstand ----------------------------------------------------------
  fail("kiosk_links")(
    (
      await supabase.from("kiosk_links").insert([
        { city_id: cityId, building_id: referencesId, title: "Isometric projection, worked through", url: "https://en.wikipedia.org/wiki/Isometric_video_game_graphics", note: "The 2:1 diamond and why depth sort is just x + y.", position: 0 },
        { city_id: cityId, building_id: referencesId, title: "A* pathfinding", url: "https://www.redblobgames.com/pathfinding/a-star/introduction.html", note: "The reference for the road solver.", position: 1 },
        { city_id: cityId, building_id: referencesId, title: "Postgres full-text search", url: "https://www.postgresql.org/docs/current/textsearch.html", note: "tsvector, GIN, and websearch_to_tsquery.", position: 2 },
        { city_id: cityId, building_id: referencesId, title: "Prefers-reduced-motion", url: "https://developer.mozilla.org/en-US/docs/Web/CSS/@media/prefers-reduced-motion", note: "The path that has to be tested, not assumed.", position: 3 },
        { city_id: cityId, building_id: referencesId, title: "Supabase row level security", url: "https://supabase.com/docs/guides/database/postgres/row-level-security", note: "Why the helper is SECURITY DEFINER.", position: 4 },
      ])
    ).error,
  );

  // --- the link graph -----------------------------------------------------
  // Seeded deliberately so roads are the first thing a new user notices:
  //   Harbor internal  : Launch Brief <-> Roadmap    = 4 links -> cobble street
  //                      Launch Brief <-> References = 1 link  -> dirt path
  //   Harbor <-> Old Town (aggregate 7 across two building pairs) -> paved
  //                      highway, crossing the river as a bridge
  //   Harbor <-> Pinegrove = 1 link -> a dirt track to the archived project
  //   Old Town <-> Pinegrove = nothing, so the contrast is visible
  fail("building_links")(
    (
      await supabase.from("building_links").insert([
        { city_id: cityId, source_building_id: launchBriefId, target_building_id: roadmapId, link_type: "wiki" },
        { city_id: cityId, source_building_id: launchBriefId, target_building_id: roadmapId, link_type: "manual" },
        { city_id: cityId, source_building_id: roadmapId, target_building_id: launchBriefId, link_type: "relation" },
        { city_id: cityId, source_building_id: roadmapId, target_building_id: launchBriefId, link_type: "wiki" },

        { city_id: cityId, source_building_id: launchBriefId, target_building_id: referencesId, link_type: "wiki" },

        { city_id: cityId, source_building_id: readingNotesId, target_building_id: launchBriefId, link_type: "wiki" },
        { city_id: cityId, source_building_id: readingNotesId, target_building_id: launchBriefId, link_type: "manual" },
        { city_id: cityId, source_building_id: launchBriefId, target_building_id: readingNotesId, link_type: "wiki" },
        { city_id: cityId, source_building_id: launchBriefId, target_building_id: readingNotesId, link_type: "relation" },
        { city_id: cityId, source_building_id: recipesId, target_building_id: roadmapId, link_type: "relation" },
        { city_id: cityId, source_building_id: roadmapId, target_building_id: recipesId, link_type: "relation" },
        { city_id: cityId, source_building_id: roadmapId, target_building_id: recipesId, link_type: "wiki" },

        { city_id: cityId, source_building_id: launchBriefId, target_building_id: fieldNotesId, link_type: "wiki" },
      ])
    ).error,
  );

  // --- activity -----------------------------------------------------------
  const now = Date.now();
  fail("activity")(
    (
      await supabase.from("activity").insert(
        ACTIVITY_HEADLINES.map((row, i) => ({
          city_id: cityId,
          actor_id: userId,
          verb: row.verb,
          subject_type: "city",
          subject_id: cityId,
          headline: row.headline,
          // Spread backwards through the last few days, newest last.
          created_at: new Date(now - (ACTIVITY_HEADLINES.length - i) * 3_600_000 * 5).toISOString(),
        })),
      )
    ).error,
  );

    return { cityId, created: true };
  } catch (error) {
    await supabase.from("cities").delete().eq("id", cityId);
    throw error;
  }
}
