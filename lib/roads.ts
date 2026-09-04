/**
 * Road routing.
 *
 * Links between artifacts are drawn as physical infrastructure, so this module
 * turns a pair of endpoints into a concrete list of tiles. Pure and DOM-free:
 * no React, no database, no randomness. Given the same grid and endpoints it
 * returns the same path every time, because a city that reshuffles its streets
 * between sessions would be worse than one with no streets at all.
 */

import type { Terrain } from "./placement";

export type Segment = "road" | "bridge" | "steps" | "gate";
export type PathTile = { x: number; y: number; segment: Segment };
export type Tile = { x: number; y: number };

export type RoadTier = "dirt" | "cobble" | "paved" | "highway";

/** Tier from the number of links a route carries. Mirrors burg.tier_for(). */
export function tierFor(linkCount: number): RoadTier {
  if (linkCount >= 10) return "highway";
  if (linkCount >= 6) return "paved";
  if (linkCount >= 3) return "cobble";
  return "dirt";
}

export type RoadGrid = {
  width: number;
  height: number;
  terrainAt: (x: number, y: number) => Terrain;
  /** Building footprints and reserved lots. Impassable. */
  isBlocked: (x: number, y: number) => boolean;
  /** Tiles an existing route already runs through. Cheap, so routes braid. */
  isRoad: (x: number, y: number) => boolean;
};

/**
 * Movement cost onto a tile.
 *
 * Existing road is nearly free, which is the whole reason routes bundle into
 * trunk lines instead of each drawing its own parallel track. Water is
 * expensive but passable -- crossing it is a bridge, not a detour.
 */
export function costOf(grid: RoadGrid, x: number, y: number): number {
  if (grid.isBlocked(x, y)) return Infinity;
  if (grid.isRoad(x, y)) return 1;

  switch (grid.terrainAt(x, y)) {
    case "road":
      return 1;
    case "cobble":
      return 3;
    case "park":
      return 5;
    case "grass":
      return 4;
    case "water":
      return 14;
  }
}

const MIN_COST = 1;

/** Neighbours in a fixed order, so equal-cost choices resolve identically. */
const STEPS: ReadonlyArray<Tile> = [
  { x: 0, y: -1 },
  { x: 1, y: 0 },
  { x: 0, y: 1 },
  { x: -1, y: 0 },
];

type Node = { x: number; y: number; g: number; f: number; h: number };

/**
 * A deterministic min-heap.
 *
 * Ties are broken on h, then x, then y, so two runs over the same grid pop
 * nodes in the same order and therefore produce byte-identical paths.
 */
class Heap {
  private items: Node[] = [];

  private static before(a: Node, b: Node): boolean {
    if (a.f !== b.f) return a.f < b.f;
    if (a.h !== b.h) return a.h < b.h;
    if (a.x !== b.x) return a.x < b.x;
    return a.y < b.y;
  }

  get size(): number {
    return this.items.length;
  }

  push(node: Node): void {
    this.items.push(node);
    let i = this.items.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (!Heap.before(this.items[i]!, this.items[parent]!)) break;
      [this.items[i], this.items[parent]] = [this.items[parent]!, this.items[i]!];
      i = parent;
    }
  }

  pop(): Node | undefined {
    const top = this.items[0];
    const last = this.items.pop();
    if (this.items.length > 0 && last) {
      this.items[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let best = i;
        if (l < this.items.length && Heap.before(this.items[l]!, this.items[best]!)) best = l;
        if (r < this.items.length && Heap.before(this.items[r]!, this.items[best]!)) best = r;
        if (best === i) break;
        [this.items[i], this.items[best]] = [this.items[best]!, this.items[i]!];
        i = best;
      }
    }
    return top;
  }
}

/** Manhattan distance, scaled by the cheapest possible step: admissible. */
function heuristic(x: number, y: number, goal: Tile): number {
  return (Math.abs(x - goal.x) + Math.abs(y - goal.y)) * MIN_COST;
}

function segmentFor(grid: RoadGrid, x: number, y: number): Segment {
  return grid.terrainAt(x, y) === "water" ? "bridge" : "road";
}

/**
 * A* between two tiles.
 *
 * Endpoints are allowed to be blocked -- a route starts and ends at a
 * building's door, and the building itself is impassable. Returns null when no
 * path exists.
 */
export function solvePath(grid: RoadGrid, from: Tile, to: Tile): PathTile[] | null {
  if (!inBounds(grid, from.x, from.y) || !inBounds(grid, to.x, to.y)) return null;
  if (from.x === to.x && from.y === to.y) {
    return [{ x: from.x, y: from.y, segment: segmentFor(grid, from.x, from.y) }];
  }

  const key = (x: number, y: number) => y * grid.width + x;
  const cameFrom = new Map<number, number>();
  const gScore = new Map<number, number>();

  const open = new Heap();
  gScore.set(key(from.x, from.y), 0);
  open.push({ x: from.x, y: from.y, g: 0, f: heuristic(from.x, from.y, to), h: heuristic(from.x, from.y, to) });

  const closed = new Set<number>();

  while (open.size > 0) {
    const current = open.pop()!;
    const currentKey = key(current.x, current.y);
    if (closed.has(currentKey)) continue;
    closed.add(currentKey);

    if (current.x === to.x && current.y === to.y) {
      return reconstruct(grid, cameFrom, currentKey, from);
    }

    for (const step of STEPS) {
      const nx = current.x + step.x;
      const ny = current.y + step.y;
      if (!inBounds(grid, nx, ny)) continue;

      const neighbourKey = key(nx, ny);
      if (closed.has(neighbourKey)) continue;

      // The goal tile is enterable even when blocked: it is a doorway.
      const isGoal = nx === to.x && ny === to.y;
      const stepCost = isGoal ? 1 : costOf(grid, nx, ny);
      if (!Number.isFinite(stepCost)) continue;

      const tentative = (gScore.get(currentKey) ?? Infinity) + stepCost;
      if (tentative >= (gScore.get(neighbourKey) ?? Infinity)) continue;

      cameFrom.set(neighbourKey, currentKey);
      gScore.set(neighbourKey, tentative);
      const h = heuristic(nx, ny, to);
      open.push({ x: nx, y: ny, g: tentative, f: tentative + h, h });
    }
  }

  return null;
}

function inBounds(grid: RoadGrid, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < grid.width && y < grid.height;
}

function reconstruct(
  grid: RoadGrid,
  cameFrom: Map<number, number>,
  endKey: number,
  from: Tile,
): PathTile[] {
  const path: PathTile[] = [];
  let cursor: number | undefined = endKey;
  const startKey = from.y * grid.width + from.x;

  while (cursor !== undefined) {
    const x = cursor % grid.width;
    const y = Math.floor(cursor / grid.width);
    path.push({ x, y, segment: segmentFor(grid, x, y) });
    if (cursor === startKey) break;
    cursor = cameFrom.get(cursor);
  }

  return path.reverse();
}

/**
 * Route through an ordered list of waypoints, joining the legs.
 *
 * Inter-neighbourhood routes go door -> gate -> gate -> door: all such traffic
 * leaves through a gate, which is what keeps the highway layer legible instead
 * of a hundred private tracks crossing open ground.
 */
export function solveRoute(grid: RoadGrid, waypoints: Tile[], gateIndices: number[] = []): PathTile[] | null {
  if (waypoints.length < 2) return null;

  const gates = new Set(gateIndices.map((i) => `${waypoints[i]?.x},${waypoints[i]?.y}`));
  const out: PathTile[] = [];

  for (let i = 0; i < waypoints.length - 1; i++) {
    const leg = solvePath(grid, waypoints[i]!, waypoints[i + 1]!);
    if (!leg) return null;
    // Drop the shared tile between consecutive legs.
    for (const tile of i === 0 ? leg : leg.slice(1)) out.push(tile);
  }

  return out.map((tile) =>
    gates.has(`${tile.x},${tile.y}`) ? { ...tile, segment: "gate" as const } : tile,
  );
}

/* -------------------------------------------------------------------------
   Gates
   ------------------------------------------------------------------------- */

export type Edge = "north" | "east" | "south" | "west";
export type Region = { origin_x: number; origin_y: number; width: number; height: number };

/**
 * Which edge of a region faces a point, and where on that edge.
 *
 * Gates are placed on the side facing the neighbour they serve, so a road
 * leaves a district heading roughly the right way instead of doubling back.
 */
export function gateToward(region: Region, target: Tile): { edge: Edge; tile: Tile; offset: number } {
  const left = region.origin_x;
  const right = region.origin_x + region.width - 1;
  const top = region.origin_y;
  const bottom = region.origin_y + region.height - 1;

  const centreX = (left + right) / 2;
  const centreY = (top + bottom) / 2;

  const dx = target.x - centreX;
  const dy = target.y - centreY;

  const edge: Edge =
    Math.abs(dx) >= Math.abs(dy) ? (dx >= 0 ? "east" : "west") : dy >= 0 ? "south" : "north";

  const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

  if (edge === "east" || edge === "west") {
    const y = clamp(Math.round(target.y), top, bottom);
    return { edge, tile: { x: edge === "east" ? right : left, y }, offset: y - top };
  }
  const x = clamp(Math.round(target.x), left, right);
  return { edge, tile: { x, y: edge === "south" ? bottom : top }, offset: x - left };
}

/** The centre tile of a region, used as a district's stand-in at city zoom. */
export function regionCentre(region: Region): Tile {
  return {
    x: region.origin_x + Math.floor(region.width / 2),
    y: region.origin_y + Math.floor(region.height / 2),
  };
}
