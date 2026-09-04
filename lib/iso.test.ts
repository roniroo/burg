import { describe, expect, it } from "vitest";
import {
  TILE_H,
  TILE_W,
  clampZoom,
  depthFor,
  footprintTiles,
  isInRegion,
  isTileVisible,
  screenToTile,
  snap,
  stepZoom,
  tileToScreen,
  visibleTileRange,
  worldBounds,
} from "./iso";

describe("tileToScreen", () => {
  it("puts the origin tile's top vertex at the origin", () => {
    expect(tileToScreen(0, 0)).toEqual({ x: 0, y: 0 });
  });

  it("moves +x up-right and +y down-right", () => {
    expect(tileToScreen(1, 0)).toEqual({ x: TILE_W / 2, y: TILE_H / 2 });
    expect(tileToScreen(0, 1)).toEqual({ x: -TILE_W / 2, y: TILE_H / 2 });
  });

  it("collapses equal x and y onto the vertical axis", () => {
    // The diagonal is the screen's centre line: x cancels, y accumulates.
    for (const n of [1, 5, 39]) {
      expect(tileToScreen(n, n).x).toBe(0);
      expect(tileToScreen(n, n).y).toBe(n * TILE_H);
    }
  });
});

describe("screenToTile", () => {
  it("round-trips every tile in a 40x40 city", () => {
    for (let x = 0; x < 40; x++) {
      for (let y = 0; y < 40; y++) {
        const screen = tileToScreen(x, y);
        // Sample the diamond's centre, not its top vertex: the vertex sits
        // exactly on the boundary of four diamonds.
        const centre = { x: screen.x, y: screen.y + TILE_H / 2 };
        expect(screenToTile(centre.x, centre.y)).toEqual({ x, y });
      }
    }
  });

  it("picks the containing diamond for points near its edges", () => {
    // Just inside tile (0,0)'s left vertex.
    expect(screenToTile(-31, 16)).toEqual({ x: 0, y: 0 });
    // Just past it, which belongs to the neighbour.
    expect(screenToTile(-33, 16)).toEqual({ x: -1, y: 1 });
  });

  it("floors rather than truncates in negative screen space", () => {
    // fx here is -0.125. Math.trunc would give tile 0; Math.floor gives -1,
    // which is the diamond the point actually sits in.
    expect(screenToTile(-10, 1)).toEqual({ x: -1, y: 0 });
  });
});

describe("depthFor", () => {
  it("sorts a 1x1 tile on x + y", () => {
    expect(depthFor(3, 4)).toBe(7);
  });

  it("sorts a multi-tile footprint on its far corner", () => {
    // A 2x2 at (4,4) covers up to (5,5), so it must sort at 10 -- not 8.
    expect(depthFor(4, 4, 2, 2)).toBe(10);
  });

  it("draws a 2x2 behind a 1x1 that stands in front of it", () => {
    const big = depthFor(4, 4, 2, 2); // covers (4,4)-(5,5)
    const inFront = depthFor(6, 6); // strictly nearer the camera
    const behind = depthFor(3, 3); // strictly further away
    expect(behind).toBeLessThan(big);
    expect(big).toBeLessThan(inFront);
  });
});

describe("footprintTiles", () => {
  it("returns the single tile of a 1x1", () => {
    expect(footprintTiles(2, 3)).toEqual([{ x: 2, y: 3 }]);
  });

  it("covers every tile of a 2x2", () => {
    expect(footprintTiles(0, 0, 2, 2)).toEqual([
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 0, y: 1 },
      { x: 1, y: 1 },
    ]);
  });
});

describe("worldBounds", () => {
  it("spans the four corner tiles of the grid", () => {
    const bounds = worldBounds(40, 40);
    // Widest points are tiles (0,39) on the left and (39,0) on the right.
    expect(bounds.x).toBe(tileToScreen(0, 39).x - TILE_W / 2);
    expect(bounds.width).toBe(
      tileToScreen(39, 0).x + TILE_W / 2 - (tileToScreen(0, 39).x - TILE_W / 2),
    );
    expect(bounds.y).toBe(0);
  });

  it("is symmetric for a square grid", () => {
    const bounds = worldBounds(20, 20);
    expect(bounds.x + bounds.width / 2).toBe(0);
  });
});

describe("culling", () => {
  const viewport = { x: 0, y: 0, width: 800, height: 600 };

  it("keeps a tile inside the viewport", () => {
    expect(isTileVisible(5, 5, viewport)).toBe(true);
  });

  it("drops a tile far outside it", () => {
    expect(isTileVisible(200, 200, viewport)).toBe(false);
  });

  it("keeps a tile just outside, within the margin", () => {
    // The margin exists so sprites do not pop in at the edge mid-pan.
    const justOutside = screenToTile(viewport.width + TILE_W, viewport.height / 2);
    expect(isTileVisible(justOutside.x, justOutside.y, viewport)).toBe(true);
  });

  it("returns a range that contains every visible tile", () => {
    const range = visibleTileRange(viewport, 40, 40);
    for (let x = 0; x < 40; x++) {
      for (let y = 0; y < 40; y++) {
        if (isTileVisible(x, y, viewport, 0)) {
          expect(x).toBeGreaterThanOrEqual(range.minX);
          expect(x).toBeLessThanOrEqual(range.maxX);
          expect(y).toBeGreaterThanOrEqual(range.minY);
          expect(y).toBeLessThanOrEqual(range.maxY);
        }
      }
    }
  });

  it("clamps the range to the grid", () => {
    const range = visibleTileRange({ x: -5000, y: -5000, width: 200, height: 200 }, 40, 40);
    expect(range.minX).toBeGreaterThanOrEqual(0);
    expect(range.minY).toBeGreaterThanOrEqual(0);
    expect(range.maxX).toBeLessThanOrEqual(39);
    expect(range.maxY).toBeLessThanOrEqual(39);
  });
});

describe("snap", () => {
  it("rounds to whole pixels so sprites never blur", () => {
    expect(snap(12.4)).toBe(12);
    expect(snap(12.5)).toBe(13);
    expect(snap(-0.5)).toBe(-0);
  });
});

describe("zoom", () => {
  it("clamps to the integer ladder", () => {
    expect(clampZoom(1.2)).toBe(1);
    expect(clampZoom(1.6)).toBe(2);
    expect(clampZoom(99)).toBe(3);
    expect(clampZoom(0.1)).toBe(1);
  });

  it("steps without leaving the ladder", () => {
    expect(stepZoom(1, 1)).toBe(2);
    expect(stepZoom(3, 1)).toBe(3);
    expect(stepZoom(1, -1)).toBe(1);
    expect(stepZoom(2, -1)).toBe(1);
  });
});

describe("isInRegion", () => {
  const region = { origin_x: 2, origin_y: 2, width: 12, height: 10 };

  it("includes the origin corner and excludes the far edge", () => {
    expect(isInRegion(2, 2, region)).toBe(true);
    expect(isInRegion(13, 11, region)).toBe(true);
    expect(isInRegion(14, 11, region)).toBe(false);
    expect(isInRegion(1, 2, region)).toBe(false);
  });
});
