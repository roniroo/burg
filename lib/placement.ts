/**
 * Where a building may stand.
 *
 * Pure and DOM-free. This module is the single authority on lot validity, and
 * it deliberately mirrors the database's exclusion constraint: the UI must
 * reject a bad placement before the round trip, and the database must reject
 * it again if the UI is wrong or two clients race.
 */

import { isInRegion } from "./iso";

export type Footprint = {
  tile_x: number;
  tile_y: number;
  footprint_w: number;
  footprint_h: number;
};

export type Region = {
  origin_x: number;
  origin_y: number;
  width: number;
  height: number;
};

export type Terrain = "grass" | "cobble" | "water" | "park" | "road";

export type PlacementRejection =
  | "occupied"
  | "outside-region"
  | "outside-city"
  | "water";

export type PlacementResult = { ok: true } | { ok: false; reason: PlacementRejection };

/** Do two footprints share any tile? */
export function overlaps(a: Footprint, b: Footprint): boolean {
  return (
    a.tile_x < b.tile_x + b.footprint_w &&
    b.tile_x < a.tile_x + a.footprint_w &&
    a.tile_y < b.tile_y + b.footprint_h &&
    b.tile_y < a.tile_y + a.footprint_h
  );
}

/** Every tile a footprint covers. */
export function tilesOf(f: Footprint): Array<{ x: number; y: number }> {
  const tiles: Array<{ x: number; y: number }> = [];
  for (let dy = 0; dy < f.footprint_h; dy++) {
    for (let dx = 0; dx < f.footprint_w; dx++) {
      tiles.push({ x: f.tile_x + dx, y: f.tile_y + dy });
    }
  }
  return tiles;
}

/**
 * Can this footprint be placed here?
 *
 * Order matters only for which message the user sees; the checks are
 * independent. City bounds come first because an out-of-bounds lot has no
 * meaningful terrain to look up.
 */
export function canPlace({
  footprint,
  region,
  occupied,
  terrainAt,
  city,
}: {
  footprint: Footprint;
  region: Region;
  occupied: Footprint[];
  terrainAt: (x: number, y: number) => Terrain;
  city: { width: number; height: number };
}): PlacementResult {
  const tiles = tilesOf(footprint);

  for (const tile of tiles) {
    if (tile.x < 0 || tile.y < 0 || tile.x >= city.width || tile.y >= city.height) {
      return { ok: false, reason: "outside-city" };
    }
  }

  for (const tile of tiles) {
    if (!isInRegion(tile.x, tile.y, region)) return { ok: false, reason: "outside-region" };
  }

  for (const tile of tiles) {
    if (terrainAt(tile.x, tile.y) === "water") return { ok: false, reason: "water" };
  }

  for (const other of occupied) {
    if (overlaps(footprint, other)) return { ok: false, reason: "occupied" };
  }

  return { ok: true };
}

export const REJECTION_MESSAGE: Record<PlacementRejection, string> = {
  occupied: "Something is already built here.",
  "outside-region": "That lot is outside this neighbourhood.",
  "outside-city": "That lot is off the edge of the city.",
  water: "You cannot build on water.",
};

/**
 * The first free lot in a region, scanned in reading order.
 *
 * Deterministic on purpose: promoting the same note twice, or replaying a
 * seed, must put buildings in the same places. Used by note promotion, which
 * has to find a lot without asking the user to pick one.
 */
export function findEmptyLot({
  region,
  occupied,
  terrainAt,
  city,
  footprintW = 1,
  footprintH = 1,
}: {
  region: Region;
  occupied: Footprint[];
  terrainAt: (x: number, y: number) => Terrain;
  city: { width: number; height: number };
  footprintW?: number;
  footprintH?: number;
}): { tile_x: number; tile_y: number } | null {
  for (let y = region.origin_y; y < region.origin_y + region.height; y++) {
    for (let x = region.origin_x; x < region.origin_x + region.width; x++) {
      const footprint = { tile_x: x, tile_y: y, footprint_w: footprintW, footprint_h: footprintH };
      if (canPlace({ footprint, region, occupied, terrainAt, city }).ok) {
        return { tile_x: x, tile_y: y };
      }
    }
  }
  return null;
}
