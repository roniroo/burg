import { describe, expect, it } from "vitest";
import { costOf, gateToward, regionCentre, solvePath, solveRoute, tierFor, type RoadGrid } from "./roads";
import type { Terrain } from "./placement";

/** A blank grid; individual tests paint terrain, blocks and roads onto it. */
function makeGrid(
  overrides: Partial<{
    width: number;
    height: number;
    terrain: Record<string, Terrain>;
    blocked: string[];
    roads: string[];
  }> = {},
): RoadGrid {
  const width = overrides.width ?? 12;
  const height = overrides.height ?? 12;
  const terrain = overrides.terrain ?? {};
  const blocked = new Set(overrides.blocked ?? []);
  const roads = new Set(overrides.roads ?? []);

  return {
    width,
    height,
    terrainAt: (x, y) => terrain[`${x},${y}`] ?? "grass",
    isBlocked: (x, y) => blocked.has(`${x},${y}`),
    isRoad: (x, y) => roads.has(`${x},${y}`),
  };
}

const asKeys = (path: { x: number; y: number }[] | null) => path?.map((t) => `${t.x},${t.y}`) ?? null;

describe("tierFor", () => {
  it("matches the thresholds the database uses", () => {
    expect(tierFor(0)).toBe("dirt");
    expect(tierFor(2)).toBe("dirt");
    expect(tierFor(3)).toBe("cobble");
    expect(tierFor(5)).toBe("cobble");
    expect(tierFor(6)).toBe("paved");
    expect(tierFor(9)).toBe("paved");
    expect(tierFor(10)).toBe("highway");
    expect(tierFor(99)).toBe("highway");
  });
});

describe("costOf", () => {
  it("makes existing road nearly free, so routes braid into trunk lines", () => {
    const grid = makeGrid({ roads: ["3,3"] });
    expect(costOf(grid, 3, 3)).toBe(1);
    expect(costOf(grid, 4, 4)).toBeGreaterThan(1);
  });

  it("makes water expensive but passable", () => {
    const grid = makeGrid({ terrain: { "2,2": "water" } });
    expect(costOf(grid, 2, 2)).toBeGreaterThan(costOf(grid, 0, 0));
    expect(Number.isFinite(costOf(grid, 2, 2))).toBe(true);
  });

  it("makes building footprints impassable", () => {
    const grid = makeGrid({ blocked: ["5,5"] });
    expect(costOf(grid, 5, 5)).toBe(Infinity);
  });
});

describe("solvePath", () => {
  it("finds a shortest path across open ground", () => {
    const path = solvePath(makeGrid(), { x: 0, y: 0 }, { x: 3, y: 0 });
    expect(asKeys(path)).toEqual(["0,0", "1,0", "2,0", "3,0"]);
  });

  it("returns the single tile when the ends coincide", () => {
    expect(asKeys(solvePath(makeGrid(), { x: 2, y: 2 }, { x: 2, y: 2 }))).toEqual(["2,2"]);
  });

  it("routes around a blocked tile", () => {
    const grid = makeGrid({ blocked: ["1,0"] });
    const path = solvePath(grid, { x: 0, y: 0 }, { x: 2, y: 0 });
    expect(asKeys(path)).not.toContain("1,0");
    expect(path?.at(-1)).toMatchObject({ x: 2, y: 0 });
  });

  it("enters a blocked goal, because the goal is a doorway", () => {
    const grid = makeGrid({ blocked: ["3,0"] });
    const path = solvePath(grid, { x: 0, y: 0 }, { x: 3, y: 0 });
    expect(path?.at(-1)).toMatchObject({ x: 3, y: 0 });
  });

  it("returns null when the goal is walled in", () => {
    const grid = makeGrid({ blocked: ["2,0", "3,1", "4,0", "3,0"] });
    // (3,0) is surrounded on every open side; only the goal itself is enterable,
    // and every approach is blocked.
    expect(solvePath(grid, { x: 0, y: 0 }, { x: 3, y: 0 })).toBeNull();
  });

  it("returns null for out-of-bounds endpoints", () => {
    expect(solvePath(makeGrid(), { x: -1, y: 0 }, { x: 2, y: 2 })).toBeNull();
    expect(solvePath(makeGrid(), { x: 0, y: 0 }, { x: 99, y: 2 })).toBeNull();
  });

  it("prefers an existing road even when it is not the straightest line", () => {
    // A road along row 2 should attract a route that would otherwise cut
    // diagonally through open grass.
    const roads = ["0,2", "1,2", "2,2", "3,2", "4,2", "5,2"];
    const grid = makeGrid({ roads });
    const path = solvePath(grid, { x: 0, y: 2 }, { x: 5, y: 2 });
    expect(asKeys(path)).toEqual(roads);
  });

  it("braids onto a trunk line rather than running parallel to it", () => {
    const trunk = ["2,0", "2,1", "2,2", "2,3", "2,4", "2,5"];
    const grid = makeGrid({ roads: trunk });
    const path = solvePath(grid, { x: 2, y: 0 }, { x: 2, y: 5 });
    // Every tile of the route lies on the existing trunk.
    expect(asKeys(path)?.every((k) => trunk.includes(k))).toBe(true);
  });

  it("crosses water and marks those tiles as bridge", () => {
    const terrain: Record<string, Terrain> = {};
    for (let y = 0; y < 12; y++) terrain[`3,${y}`] = "water";
    const grid = makeGrid({ terrain });
    const path = solvePath(grid, { x: 0, y: 0 }, { x: 6, y: 0 });
    expect(path).not.toBeNull();
    const bridges = path!.filter((t) => t.segment === "bridge");
    expect(bridges).toHaveLength(1);
    expect(bridges[0]).toMatchObject({ x: 3, y: 0 });
  });

  it("goes around water when the detour is cheaper than the crossing", () => {
    // A short water bar with open ground just below it.
    const grid = makeGrid({ terrain: { "3,0": "water" } });
    const path = solvePath(grid, { x: 2, y: 0 }, { x: 4, y: 0 });
    expect(asKeys(path)).not.toContain("3,0");
  });

  it("is deterministic: the same inputs give byte-identical paths", () => {
    const grid = makeGrid({ blocked: ["4,4", "5,5"], roads: ["1,1"] });
    const a = solvePath(grid, { x: 0, y: 0 }, { x: 9, y: 9 });
    const b = solvePath(grid, { x: 0, y: 0 }, { x: 9, y: 9 });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("produces a contiguous path with no gaps", () => {
    const path = solvePath(makeGrid({ blocked: ["3,3", "3,4"] }), { x: 0, y: 0 }, { x: 7, y: 7 })!;
    for (let i = 1; i < path.length; i++) {
      const step = Math.abs(path[i]!.x - path[i - 1]!.x) + Math.abs(path[i]!.y - path[i - 1]!.y);
      expect(step).toBe(1);
    }
  });
});

describe("solveRoute", () => {
  it("joins legs through waypoints without repeating the shared tile", () => {
    const route = solveRoute(makeGrid(), [
      { x: 0, y: 0 },
      { x: 3, y: 0 },
      { x: 3, y: 3 },
    ]);
    const keys = asKeys(route)!;
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys[0]).toBe("0,0");
    expect(keys.at(-1)).toBe("3,3");
  });

  it("marks the waypoints named as gates", () => {
    const route = solveRoute(
      makeGrid(),
      [
        { x: 0, y: 0 },
        { x: 3, y: 0 },
        { x: 6, y: 0 },
      ],
      [1],
    );
    const gate = route!.filter((t) => t.segment === "gate");
    expect(gate).toHaveLength(1);
    expect(gate[0]).toMatchObject({ x: 3, y: 0 });
  });

  it("returns null when any leg is impossible", () => {
    const grid = makeGrid({ blocked: ["1,0", "0,1", "1,1"] });
    expect(solveRoute(grid, [{ x: 0, y: 0 }, { x: 5, y: 5 }])).toBeNull();
  });

  it("needs at least two waypoints", () => {
    expect(solveRoute(makeGrid(), [{ x: 0, y: 0 }])).toBeNull();
  });
});

describe("gateToward", () => {
  const region = { origin_x: 4, origin_y: 4, width: 6, height: 6 };

  it("opens on the side facing the target", () => {
    expect(gateToward(region, { x: 30, y: 6 }).edge).toBe("east");
    expect(gateToward(region, { x: 0, y: 6 }).edge).toBe("west");
    expect(gateToward(region, { x: 6, y: 30 }).edge).toBe("south");
    expect(gateToward(region, { x: 6, y: 0 }).edge).toBe("north");
  });

  it("places the gate on the region's perimeter", () => {
    const gate = gateToward(region, { x: 30, y: 7 });
    expect(gate.tile.x).toBe(region.origin_x + region.width - 1);
    expect(gate.tile.y).toBeGreaterThanOrEqual(region.origin_y);
    expect(gate.tile.y).toBeLessThan(region.origin_y + region.height);
  });

  it("clamps a target beyond the edge back onto the perimeter", () => {
    const gate = gateToward(region, { x: 30, y: 999 });
    expect(gate.tile.y).toBe(region.origin_y + region.height - 1);
  });

  it("is deterministic for a target exactly on the diagonal", () => {
    // Ties resolve to the horizontal edge, consistently.
    const a = gateToward(region, { x: 20, y: 20 });
    const b = gateToward(region, { x: 20, y: 20 });
    expect(a).toEqual(b);
    expect(a.edge).toBe("east");
  });
});

describe("regionCentre", () => {
  it("returns the middle tile", () => {
    expect(regionCentre({ origin_x: 4, origin_y: 4, width: 6, height: 6 })).toEqual({ x: 7, y: 7 });
  });
});
