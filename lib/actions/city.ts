"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { canPlace, type Footprint, type Terrain } from "@/lib/placement";
import { SPRITE_FOR_TYPE } from "@/lib/sprites";
import type { Json } from "@/lib/database.types";

/**
 * City-shaping actions: placing buildings, founding neighbourhoods, moving and
 * resizing regions.
 *
 * Placement is validated here with the same pure module the UI uses, and then
 * again by the database's exclusion constraint. The duplication is deliberate:
 * the client check is for the ghost sprite, this one is for correctness, and
 * the constraint is for two clients racing.
 */

export type ActionResult<T = undefined> =
  | ({ ok: true } & (T extends undefined ? object : { data: T }))
  | { ok: false; error: string };

const ARTIFACT_TYPES = ["doc", "table", "board", "canvas", "kiosk"] as const;

const createBuildingSchema = z.object({
  neighborhoodId: z.uuid(),
  title: z.string().trim().min(1, "Give it a name.").max(160),
  artifactType: z.enum(ARTIFACT_TYPES),
  tileX: z.number().int().min(0).max(511),
  tileY: z.number().int().min(0).max(511),
  footprintW: z.number().int().min(1).max(4).default(1),
  footprintH: z.number().int().min(1).max(4).default(1),
  floors: z.number().int().min(1).max(3).default(1),
  spriteVariant: z.number().int().min(1).max(3).default(1),
});

/** Everything needed to validate a lot, fetched once. */
async function placementContext(
  supabase: Awaited<ReturnType<typeof createClient>>,
  neighborhoodId: string,
) {
  const { data: hood } = await supabase
    .from("neighborhoods")
    .select("*")
    .eq("id", neighborhoodId)
    .maybeSingle();
  if (!hood) return null;

  const [{ data: city }, { data: siblings }, { data: tiles }] = await Promise.all([
    supabase.from("cities").select("id, width, height").eq("id", hood.city_id).maybeSingle(),
    supabase
      .from("buildings")
      .select("id, tile_x, tile_y, footprint_w, footprint_h")
      .eq("city_id", hood.city_id),
    supabase.from("tiles").select("x, y, terrain").eq("city_id", hood.city_id),
  ]);
  if (!city) return null;

  const terrain = new Map((tiles ?? []).map((t) => [`${t.x},${t.y}`, t.terrain as Terrain]));

  return {
    hood,
    city,
    occupied: (siblings ?? []) as Array<Footprint & { id: string }>,
    terrainAt: (x: number, y: number) => terrain.get(`${x},${y}`) ?? ("grass" as Terrain),
  };
}

export async function createBuilding(input: unknown): Promise<ActionResult<{ id: string }>> {
  const parsed = createBuildingSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid placement." };
  }

  const p = parsed.data;
  const supabase = await createClient();
  const context = await placementContext(supabase, p.neighborhoodId);
  if (!context) return { ok: false, error: "That neighbourhood no longer exists." };

  const footprint: Footprint = {
    tile_x: p.tileX,
    tile_y: p.tileY,
    footprint_w: p.footprintW,
    footprint_h: p.footprintH,
  };

  const verdict = canPlace({
    footprint,
    region: context.hood,
    occupied: context.occupied,
    terrainAt: context.terrainAt,
    city: context.city,
  });
  if (!verdict.ok) return { ok: false, error: rejectionMessage(verdict.reason) };

  const id = crypto.randomUUID();
  const { error } = await supabase.from("buildings").insert({
    id,
    city_id: context.city.id,
    neighborhood_id: p.neighborhoodId,
    title: p.title,
    artifact_type: p.artifactType,
    sprite_key: SPRITE_FOR_TYPE[p.artifactType],
    sprite_variant: p.spriteVariant,
    tile_x: p.tileX,
    tile_y: p.tileY,
    footprint_w: p.footprintW,
    footprint_h: p.footprintH,
    floors: p.floors,
    position: context.occupied.length,
  });

  if (error) {
    // The exclusion constraint is the last word if a client raced us.
    if (error.code === "23P01" || error.code === "23505") {
      return { ok: false, error: "Something was just built on that lot." };
    }
    return { ok: false, error: error.message };
  }

  const payload = await createArtifactPayload(supabase, id, context.city.id, p.artifactType);
  if (payload) return payload;

  await supabase.from("activity").insert({
    city_id: context.city.id,
    verb: "built",
    subject_type: "building",
    subject_id: id,
    headline: `Ground broken on ${p.title} in ${context.hood.name}`,
  });

  revalidatePath("/city");
  revalidatePath("/directory");
  return { ok: true, data: { id } };
}

/** Every artifact type needs its payload row to exist before the interior opens. */
async function createArtifactPayload(
  supabase: Awaited<ReturnType<typeof createClient>>,
  buildingId: string,
  cityId: string,
  type: (typeof ARTIFACT_TYPES)[number],
): Promise<{ ok: false; error: string } | null> {
  if (type === "doc") {
    const { error } = await supabase.from("documents").insert({ building_id: buildingId, city_id: cityId });
    return error ? { ok: false, error: error.message } : null;
  }
  if (type === "board") {
    const { error } = await supabase.from("boards").insert({ building_id: buildingId, city_id: cityId });
    return error ? { ok: false, error: error.message } : null;
  }
  if (type === "canvas") {
    const { error } = await supabase.from("canvases").insert({ building_id: buildingId, city_id: cityId });
    return error ? { ok: false, error: error.message } : null;
  }
  if (type === "table") {
    const { error } = await supabase.from("data_tables").insert({
      building_id: buildingId,
      city_id: cityId,
      name: "Table",
    });
    if (error) return { ok: false, error: error.message };

    // A table with no columns cannot be edited, so it starts with a primary
    // text column and a table view.
    const fieldId = crypto.randomUUID();
    const { error: fieldError } = await supabase.from("table_fields").insert({
      id: fieldId,
      city_id: cityId,
      building_id: buildingId,
      name: "Name",
      field_type: "text",
      options: {} as Json,
      position: 0,
      width: 260,
    });
    if (fieldError) return { ok: false, error: fieldError.message };

    await supabase.from("data_tables").update({ primary_field_id: fieldId }).eq("building_id", buildingId);
    await supabase.from("table_views").insert({
      city_id: cityId,
      building_id: buildingId,
      name: "All items",
      view_type: "table",
      position: 0,
      group_by_field_id: null,
    });
    return null;
  }
  // kiosk has no payload row; its links are created as they are added.
  return null;
}

function rejectionMessage(reason: string): string {
  switch (reason) {
    case "occupied":
      return "Something is already built there.";
    case "outside-region":
      return "That lot is outside the neighbourhood.";
    case "outside-city":
      return "That lot is off the edge of the city.";
    case "water":
      return "You cannot build on water.";
    default:
      return "That lot will not do.";
  }
}

const moveBuildingSchema = z.object({
  buildingId: z.uuid(),
  tileX: z.number().int().min(0).max(511),
  tileY: z.number().int().min(0).max(511),
});

export async function moveBuilding(input: unknown): Promise<ActionResult> {
  const parsed = moveBuildingSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid move." };

  const supabase = await createClient();
  const { data: building } = await supabase
    .from("buildings")
    .select("id, neighborhood_id, footprint_w, footprint_h")
    .eq("id", parsed.data.buildingId)
    .maybeSingle();
  if (!building) return { ok: false, error: "That building no longer exists." };

  const context = await placementContext(supabase, building.neighborhood_id);
  if (!context) return { ok: false, error: "That neighbourhood no longer exists." };

  const verdict = canPlace({
    footprint: {
      tile_x: parsed.data.tileX,
      tile_y: parsed.data.tileY,
      footprint_w: building.footprint_w,
      footprint_h: building.footprint_h,
    },
    region: context.hood,
    // A building never collides with itself.
    occupied: context.occupied.filter((b) => b.id !== building.id),
    terrainAt: context.terrainAt,
    city: context.city,
  });
  if (!verdict.ok) return { ok: false, error: rejectionMessage(verdict.reason) };

  const { error } = await supabase
    .from("buildings")
    .update({ tile_x: parsed.data.tileX, tile_y: parsed.data.tileY })
    .eq("id", building.id);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/city");
  return { ok: true };
}

const createNeighborhoodSchema = z.object({
  cityId: z.uuid(),
  name: z.string().trim().min(1, "Give it a name.").max(120),
  description: z.string().trim().max(500).default(""),
  biome: z.enum(["downtown", "harbor", "forest", "desert", "snow"]),
  originX: z.number().int().min(0).max(511),
  originY: z.number().int().min(0).max(511),
  width: z.number().int().min(3).max(40),
  height: z.number().int().min(3).max(40),
});

export async function createNeighborhood(input: unknown): Promise<ActionResult<{ id: string; slug: string }>> {
  const parsed = createNeighborhoodSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid neighbourhood." };
  }

  const p = parsed.data;
  const supabase = await createClient();

  const { data: city } = await supabase
    .from("cities").select("id, width, height").eq("id", p.cityId).maybeSingle();
  if (!city) return { ok: false, error: "That city no longer exists." };

  if (p.originX + p.width > city.width || p.originY + p.height > city.height) {
    return { ok: false, error: "That region runs off the edge of the city." };
  }

  const { data: existing } = await supabase
    .from("neighborhoods")
    .select("id, slug, origin_x, origin_y, width, height")
    .eq("city_id", p.cityId);

  // Regions must not overlap; two districts sharing tiles makes both the
  // biome tinting and the gate routing ambiguous.
  for (const other of existing ?? []) {
    const overlaps =
      p.originX < other.origin_x + other.width &&
      other.origin_x < p.originX + p.width &&
      p.originY < other.origin_y + other.height &&
      other.origin_y < p.originY + p.height;
    if (overlaps) return { ok: false, error: "That region overlaps an existing neighbourhood." };
  }

  const base = p.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "district";
  const taken = new Set((existing ?? []).map((n) => n.slug));
  let slug = base;
  for (let i = 2; taken.has(slug); i++) slug = `${base}-${i}`;

  const id = crypto.randomUUID();
  const { error } = await supabase.from("neighborhoods").insert({
    id,
    city_id: p.cityId,
    name: p.name,
    slug,
    description: p.description,
    biome: p.biome,
    status: "planning",
    origin_x: p.originX,
    origin_y: p.originY,
    width: p.width,
    height: p.height,
    position: (existing ?? []).length,
  });
  if (error) return { ok: false, error: error.message };

  // Tint the ground so the region reads as a district immediately.
  const tiles = [];
  for (let x = p.originX; x < p.originX + p.width; x++) {
    for (let y = p.originY; y < p.originY + p.height; y++) {
      tiles.push({ city_id: p.cityId, x, y, terrain: "cobble" as const, neighborhood_id: id });
    }
  }
  await supabase.from("tiles").upsert(tiles, { onConflict: "city_id,x,y" });

  await supabase.from("activity").insert({
    city_id: p.cityId,
    verb: "founded",
    subject_type: "neighborhood",
    subject_id: id,
    headline: `${p.name} founded; surveyors mark out ${p.width} by ${p.height} lots`,
  });

  revalidatePath("/city");
  revalidatePath("/directory");
  return { ok: true, data: { id, slug } };
}

const moveRegionSchema = z.object({
  neighborhoodId: z.uuid(),
  originX: z.number().int().min(0).max(511),
  originY: z.number().int().min(0).max(511),
  width: z.number().int().min(3).max(40).optional(),
  height: z.number().int().min(3).max(40).optional(),
});

/**
 * Relocate or resize a region, carrying its buildings with it.
 *
 * Buildings move by the same delta, so a district keeps its internal layout.
 * Shrinking is refused if it would leave a building outside, rather than
 * silently orphaning it.
 */
export async function moveNeighborhood(input: unknown): Promise<ActionResult> {
  const parsed = moveRegionSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid region change." };

  const p = parsed.data;
  const supabase = await createClient();

  const { data: hood } = await supabase
    .from("neighborhoods").select("*").eq("id", p.neighborhoodId).maybeSingle();
  if (!hood) return { ok: false, error: "That neighbourhood no longer exists." };

  const width = p.width ?? hood.width;
  const height = p.height ?? hood.height;
  const dx = p.originX - hood.origin_x;
  const dy = p.originY - hood.origin_y;

  const [{ data: city }, { data: others }, { data: buildings }] = await Promise.all([
    supabase.from("cities").select("width, height").eq("id", hood.city_id).maybeSingle(),
    supabase
      .from("neighborhoods")
      .select("id, origin_x, origin_y, width, height")
      .eq("city_id", hood.city_id)
      .neq("id", hood.id),
    supabase
      .from("buildings")
      .select("id, tile_x, tile_y, footprint_w, footprint_h")
      .eq("neighborhood_id", hood.id),
  ]);
  if (!city) return { ok: false, error: "That city no longer exists." };

  if (p.originX + width > city.width || p.originY + height > city.height) {
    return { ok: false, error: "That region runs off the edge of the city." };
  }

  for (const other of others ?? []) {
    const overlaps =
      p.originX < other.origin_x + other.width &&
      other.origin_x < p.originX + width &&
      p.originY < other.origin_y + other.height &&
      other.origin_y < p.originY + height;
    if (overlaps) return { ok: false, error: "That would overlap another neighbourhood." };
  }

  for (const building of buildings ?? []) {
    const nx = building.tile_x + dx;
    const ny = building.tile_y + dy;
    const fits =
      nx >= p.originX &&
      ny >= p.originY &&
      nx + building.footprint_w <= p.originX + width &&
      ny + building.footprint_h <= p.originY + height;
    if (!fits) {
      return { ok: false, error: "That would leave a building outside the neighbourhood." };
    }
  }

  const { error } = await supabase
    .from("neighborhoods")
    .update({ origin_x: p.originX, origin_y: p.originY, width, height })
    .eq("id", hood.id);
  if (error) return { ok: false, error: error.message };

  // Move the buildings by the same delta. Done one at a time because the
  // exclusion constraint is evaluated per statement, and a bulk update could
  // transiently collide with a lot the region is vacating.
  if (dx !== 0 || dy !== 0) {
    const ordered = [...(buildings ?? [])].sort((a, b) =>
      dx + dy > 0 ? b.tile_x + b.tile_y - (a.tile_x + a.tile_y) : a.tile_x + a.tile_y - (b.tile_x + b.tile_y),
    );
    for (const building of ordered) {
      const { error: moveError } = await supabase
        .from("buildings")
        .update({ tile_x: building.tile_x + dx, tile_y: building.tile_y + dy })
        .eq("id", building.id);
      if (moveError) return { ok: false, error: moveError.message };
    }
  }

  revalidatePath("/city");
  revalidatePath("/directory");
  return { ok: true };
}

// --------------------------------------------------------------------------
// Demolition
// --------------------------------------------------------------------------
//
// Deleting is the one direction the database does most of the work in. Every
// artifact payload, link and road route hangs off `buildings` with `on delete
// cascade`, so removing the building row removes the document, the rows, the
// notes, the links pointing at it and the roads that carried them. What SQL
// cannot do is the bookkeeping around it: the activity ticker keeps announcing
// a building that no longer exists, and a dissolved district leaves its
// cobbles behind, because `tiles.neighborhood_id` is `on delete set null`.

const deleteBuildingSchema = z.object({ buildingId: z.uuid() });

/**
 * Demolish one building, and with it everything kept inside.
 *
 * RLS is the authorization boundary -- a non-member's delete matches no rows
 * -- so the read here is for the headline and the cleanup, not for the check.
 */
export async function deleteBuilding(input: unknown): Promise<ActionResult<{ title: string }>> {
  const parsed = deleteBuildingSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid building." };

  const supabase = await createClient();
  const { data: building } = await supabase
    .from("buildings")
    .select("id, title, city_id, neighborhood_id")
    .eq("id", parsed.data.buildingId)
    .maybeSingle();
  if (!building) return { ok: false, error: "That building is already gone." };

  const { data: hood } = await supabase
    .from("neighborhoods")
    .select("name")
    .eq("id", building.neighborhood_id)
    .maybeSingle();

  const { error } = await supabase.from("buildings").delete().eq("id", building.id);
  if (error) return { ok: false, error: error.message };

  // Headlines outlive their subjects -- `activity.subject_id` carries no
  // foreign key, deliberately, so the ticker can talk about things that have
  // since changed. A demolished building is the one case where that reads as
  // a bug, so its old headlines go with it.
  await supabase.from("activity").delete().eq("city_id", building.city_id).eq("subject_id", building.id);
  await supabase.from("activity").insert({
    city_id: building.city_id,
    verb: "demolished",
    subject_type: "building",
    subject_id: null,
    headline: `${building.title} demolished${hood ? `; the lot in ${hood.name} stands empty` : ""}`,
  });

  revalidatePath("/city");
  revalidatePath("/directory");
  revalidatePath("/n/[slug]", "page");
  return { ok: true, data: { title: building.title } };
}

const deleteNeighborhoodSchema = z.object({ neighborhoodId: z.uuid() });

/**
 * Dissolve a district, demolishing everything standing in it.
 *
 * The tiles it claimed are deleted rather than reset: an absent tile row
 * renders as plain grass, which is what unclaimed ground is everywhere else
 * on the map. They have to go first, while they still know which district
 * they belonged to.
 */
export async function deleteNeighborhood(
  input: unknown,
): Promise<ActionResult<{ name: string; demolished: number }>> {
  const parsed = deleteNeighborhoodSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid neighbourhood." };

  const supabase = await createClient();
  const { data: hood } = await supabase
    .from("neighborhoods")
    .select("id, name, city_id")
    .eq("id", parsed.data.neighborhoodId)
    .maybeSingle();
  if (!hood) return { ok: false, error: "That neighbourhood is already gone." };

  const { data: buildings } = await supabase
    .from("buildings")
    .select("id")
    .eq("neighborhood_id", hood.id);
  const buildingIds = (buildings ?? []).map((b) => b.id);

  const { error: tileError } = await supabase.from("tiles").delete().eq("neighborhood_id", hood.id);
  if (tileError) return { ok: false, error: tileError.message };

  const { error } = await supabase.from("neighborhoods").delete().eq("id", hood.id);
  if (error) return { ok: false, error: error.message };

  const subjects = [...buildingIds, hood.id];
  await supabase.from("activity").delete().eq("city_id", hood.city_id).in("subject_id", subjects);
  await supabase.from("activity").insert({
    city_id: hood.city_id,
    verb: "dissolved",
    subject_type: "neighborhood",
    subject_id: null,
    headline:
      buildingIds.length > 0
        ? `${hood.name} dissolved; ${buildingIds.length} building${buildingIds.length === 1 ? "" : "s"} came down with it`
        : `${hood.name} dissolved; the survey markers are pulled up`,
  });

  revalidatePath("/city");
  revalidatePath("/directory");
  revalidatePath("/n/[slug]", "page");
  return { ok: true, data: { name: hood.name, demolished: buildingIds.length } };
}

const clearCitySchema = z.object({
  cityId: z.uuid(),
  scope: z.enum(["buildings", "everything"]),
  /** The city's own name, typed by hand. Checked server-side, not just in the UI. */
  confirmName: z.string().trim().min(1),
});

/**
 * Start over.
 *
 * `buildings` razes every building and leaves the districts standing;
 * `everything` takes the districts and their ground too, back to open grass.
 * The typed name is re-checked here because the button that guards it is only
 * a button -- the action is a public endpoint like any other.
 */
export async function clearCity(
  input: unknown,
): Promise<ActionResult<{ buildings: number; neighborhoods: number }>> {
  const parsed = clearCitySchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid request." };

  const { cityId, scope, confirmName } = parsed.data;
  const supabase = await createClient();

  const { data: city } = await supabase.from("cities").select("id, name").eq("id", cityId).maybeSingle();
  if (!city) return { ok: false, error: "That city no longer exists." };
  if (confirmName.toLowerCase() !== city.name.toLowerCase()) {
    return { ok: false, error: `Type the city's name exactly — "${city.name}" — to confirm.` };
  }

  const [{ data: buildings }, { data: hoods }] = await Promise.all([
    supabase.from("buildings").select("id").eq("city_id", city.id),
    supabase.from("neighborhoods").select("id").eq("city_id", city.id),
  ]);
  const buildingCount = (buildings ?? []).length;
  const hoodCount = (hoods ?? []).length;

  if (scope === "everything") {
    // Only ground a district claimed. Water and anything else the terrain
    // generator laid down is landscape, not content, and stays.
    const { error: tileError } = await supabase
      .from("tiles")
      .delete()
      .eq("city_id", city.id)
      .not("neighborhood_id", "is", null);
    if (tileError) return { ok: false, error: tileError.message };

    // Districts cascade to their buildings, and buildings to everything else.
    const { error } = await supabase.from("neighborhoods").delete().eq("city_id", city.id);
    if (error) return { ok: false, error: error.message };
  }

  // Buildings outside any surviving district, or all of them when the
  // districts were kept.
  const { error: buildingError } = await supabase.from("buildings").delete().eq("city_id", city.id);
  if (buildingError) return { ok: false, error: buildingError.message };

  await supabase.from("activity").delete().eq("city_id", city.id);
  await supabase.from("activity").insert({
    city_id: city.id,
    verb: "cleared",
    subject_type: "city",
    subject_id: null,
    headline:
      scope === "everything"
        ? `${city.name} cleared to open ground; the survey starts again`
        : `${city.name} cleared; ${buildingCount} building${buildingCount === 1 ? "" : "s"} came down and the districts remain`,
  });

  revalidatePath("/city");
  revalidatePath("/directory");
  revalidatePath("/n/[slug]", "page");
  return {
    ok: true,
    data: { buildings: buildingCount, neighborhoods: scope === "everything" ? hoodCount : 0 },
  };
}
