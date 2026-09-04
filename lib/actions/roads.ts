"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { gateToward, regionCentre, solveRoute, type PathTile, type RoadGrid } from "@/lib/roads";
import type { Terrain } from "@/lib/placement";
import type { Json } from "@/lib/database.types";

/**
 * Solve every stale road route in a city.
 *
 * SQL only ever marks a route stale; the pathfinding happens here, in app
 * code, using the pure solver. Routes are solved in a stable order and each
 * one's tiles are fed back into the grid as cheap "existing road", which is
 * what makes later routes braid onto earlier ones instead of running parallel
 * to them. That also means the order has to be deterministic, or the city
 * would re-plan itself differently on every pass.
 */

export type SolveResult =
  | { ok: true; solved: number; failed: number; removed: number; solvedIds: string[] }
  | { ok: false; error: string };

const schema = z.object({ cityId: z.uuid() });

export async function solveStaleRoutes(input: unknown): Promise<SolveResult> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid city." };

  const { cityId } = parsed.data;
  const supabase = await createClient();

  const [{ data: city }, { data: routes }, { data: buildings }, { data: hoods }, { data: tiles }, { data: gates }] =
    await Promise.all([
      supabase.from("cities").select("id, width, height").eq("id", cityId).maybeSingle(),
      supabase.from("road_routes").select("*").eq("city_id", cityId).order("id"),
      supabase
        .from("buildings")
        .select("id, tile_x, tile_y, footprint_w, footprint_h, neighborhood_id")
        .eq("city_id", cityId),
      supabase.from("neighborhoods").select("*").eq("city_id", cityId),
      supabase.from("tiles").select("x, y, terrain").eq("city_id", cityId),
      supabase.from("gates").select("*").eq("city_id", cityId),
    ]);

  if (!city) return { ok: false, error: "That city no longer exists." };

  const buildingById = new Map((buildings ?? []).map((b) => [b.id, b]));
  const hoodById = new Map((hoods ?? []).map((h) => [h.id, h]));
  const terrainByKey = new Map((tiles ?? []).map((t) => [`${t.x},${t.y}`, t.terrain as Terrain]));

  // Footprints are impassable, but a route's own endpoints are doorways and
  // are handled by the solver.
  const blocked = new Set<string>();
  for (const b of buildings ?? []) {
    for (let dy = 0; dy < b.footprint_h; dy++) {
      for (let dx = 0; dx < b.footprint_w; dx++) blocked.add(`${b.tile_x + dx},${b.tile_y + dy}`);
    }
  }

  // Tiles already carrying a solved route. Seeded from the routes that are not
  // stale so a single re-solve still braids onto the existing network.
  const roadTiles = new Set<string>();
  for (const route of routes ?? []) {
    if (route.stale) continue;
    for (const tile of (route.path ?? []) as PathTile[]) roadTiles.add(`${tile.x},${tile.y}`);
  }

  const grid: RoadGrid = {
    width: city.width,
    height: city.height,
    terrainAt: (x, y) => terrainByKey.get(`${x},${y}`) ?? "grass",
    isBlocked: (x, y) => blocked.has(`${x},${y}`),
    isRoad: (x, y) => roadTiles.has(`${x},${y}`),
  };

  /** Find or create the gate on the side of `hood` that faces `target`. */
  const gateCache = new Map<string, { id: string; tile: { x: number; y: number } }>();
  async function gateFor(hoodId: string, target: { x: number; y: number }) {
    const hood = hoodById.get(hoodId);
    if (!hood) return null;

    const wanted = gateToward(hood, target);
    const cacheKey = `${hoodId}:${wanted.edge}`;
    const cached = gateCache.get(cacheKey);
    if (cached) return cached;

    const existing = (gates ?? []).find((g) => g.neighborhood_id === hoodId && g.edge === wanted.edge);
    if (existing) {
      const found = { id: existing.id, tile: { x: existing.tile_x, y: existing.tile_y } };
      gateCache.set(cacheKey, found);
      return found;
    }

    const id = crypto.randomUUID();
    const { error } = await supabase.from("gates").insert({
      id,
      city_id: cityId,
      neighborhood_id: hoodId,
      edge: wanted.edge,
      edge_offset: wanted.offset,
      tile_x: wanted.tile.x,
      tile_y: wanted.tile.y,
      is_auto: true,
    });
    if (error) return null;

    const made = { id, tile: wanted.tile };
    gateCache.set(cacheKey, made);
    return made;
  }

  let solved = 0;
  let failed = 0;
  let removed = 0;
  const solvedIds: string[] = [];

  for (const route of routes ?? []) {
    // A route whose last link was cut is kept at count 0 so the client can
    // weather it away; once that has happened it is swept up here.
    if (route.link_count === 0) {
      await supabase.from("road_routes").delete().eq("id", route.id);
      removed++;
      continue;
    }
    if (!route.stale) continue;

    const a = buildingById.get(route.a_building_id);
    const b = buildingById.get(route.b_building_id);
    if (!a || !b) {
      failed++;
      continue;
    }

    const from = { x: a.tile_x, y: a.tile_y };
    const to = { x: b.tile_x, y: b.tile_y };

    let waypoints = [from, to];
    let gateIndices: number[] = [];
    let aGateId: string | null = null;
    let bGateId: string | null = null;

    if (a.neighborhood_id !== b.neighborhood_id) {
      // All inter-district traffic leaves through a gate. Without that rule
      // the highway layer becomes a hundred private tracks.
      const hoodA = hoodById.get(a.neighborhood_id);
      const hoodB = hoodById.get(b.neighborhood_id);
      if (hoodA && hoodB) {
        const gateA = await gateFor(a.neighborhood_id, regionCentre(hoodB));
        const gateB = await gateFor(b.neighborhood_id, regionCentre(hoodA));
        if (gateA && gateB) {
          waypoints = [from, gateA.tile, gateB.tile, to];
          gateIndices = [1, 2];
          aGateId = gateA.id;
          bGateId = gateB.id;
        }
      }
    }

    const path = solveRoute(grid, waypoints, gateIndices);
    if (!path) {
      failed++;
      continue;
    }

    const { error } = await supabase
      .from("road_routes")
      .update({
        path: path as unknown as Json,
        stale: false,
        a_gate_id: aGateId,
        b_gate_id: bGateId,
      })
      .eq("id", route.id);

    if (error) {
      failed++;
      continue;
    }

    for (const tile of path) roadTiles.add(`${tile.x},${tile.y}`);
    solvedIds.push(route.id);
    solved++;
  }

  if (solved > 0 || removed > 0) revalidatePath("/city");
  return { ok: true, solved, failed, removed, solvedIds };
}
