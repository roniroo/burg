/**
 * Isometric projection maths.
 *
 * This is the only place tile <-> screen arithmetic exists. Components import
 * from here; they never re-derive the projection inline. Pure: no React, no
 * DOM, no side effects, so it is unit-testable in isolation.
 *
 * Geometry is the classic 2:1 diamond. `tileToScreen` returns the position of
 * a tile's TOP vertex, so a tile's diamond occupies:
 *
 *     x from screen.x - TILE_W/2 to screen.x + TILE_W/2
 *     y from screen.y            to screen.y + TILE_H
 *
 *                    (x, y)          <- tileToScreen
 *                   .      .
 *          (x-32, y+16)    (x+32, y+16)
 *                   `      `
 *                  (x, y+32)
 */

export const TILE_W = 64;
export const TILE_H = 32;

const HALF_W = TILE_W / 2;
const HALF_H = TILE_H / 2;

export type Tile = { x: number; y: number };
export type Point = { x: number; y: number };
export type Rect = { x: number; y: number; width: number; height: number };

/** Tile coordinates -> screen position of that tile's top vertex. */
export function tileToScreen(tileX: number, tileY: number): Point {
  return {
    x: (tileX - tileY) * HALF_W,
    y: (tileX + tileY) * HALF_H,
  };
}

/**
 * Screen position -> the tile containing it.
 *
 * Inverse of `tileToScreen`, floored: any point inside a diamond maps to that
 * diamond's tile. Used for cursor picking in build mode.
 */
export function screenToTile(screenX: number, screenY: number): Tile {
  const fx = screenX / TILE_W + screenY / TILE_H;
  const fy = screenY / TILE_H - screenX / TILE_W;
  return { x: Math.floor(fx), y: Math.floor(fy) };
}

/**
 * Painter's-algorithm depth for a footprint.
 *
 * A 1x1 tile sorts on x + y. A multi-tile building must sort on its FAR
 * corner -- the tile with the greatest x + y -- otherwise a 2x2 draws behind
 * a 1x1 that is actually in front of it.
 */
export function depthFor(tileX: number, tileY: number, footprintW = 1, footprintH = 1): number {
  return tileX + footprintW - 1 + (tileY + footprintH - 1);
}

/** Every tile covered by a footprint, in row-major order. */
export function footprintTiles(
  tileX: number,
  tileY: number,
  footprintW = 1,
  footprintH = 1,
): Tile[] {
  const tiles: Tile[] = [];
  for (let dy = 0; dy < footprintH; dy++) {
    for (let dx = 0; dx < footprintW; dx++) {
      tiles.push({ x: tileX + dx, y: tileY + dy });
    }
  }
  return tiles;
}

/**
 * Screen-space bounding box of a whole grid.
 *
 * The diamond grid's extremes are its four corner tiles: (0,0) is the top,
 * (w-1, h-1) the bottom, (w-1, 0) the right and (0, h-1) the left.
 */
export function worldBounds(gridW: number, gridH: number): Rect {
  const left = tileToScreen(0, gridH - 1).x - HALF_W;
  const right = tileToScreen(gridW - 1, 0).x + HALF_W;
  const top = tileToScreen(0, 0).y;
  const bottom = tileToScreen(gridW - 1, gridH - 1).y + TILE_H;
  return { x: left, y: top, width: right - left, height: bottom - top };
}

/**
 * Is a tile's diamond within the viewport (plus a margin)?
 *
 * Culling is what keeps a few hundred DOM sprites at 60fps -- offscreen tiles
 * are never rendered at all.
 */
export function isTileVisible(tileX: number, tileY: number, viewport: Rect, margin = TILE_W * 2): boolean {
  const { x, y } = tileToScreen(tileX, tileY);
  return (
    x + HALF_W >= viewport.x - margin &&
    x - HALF_W <= viewport.x + viewport.width + margin &&
    y + TILE_H >= viewport.y - margin &&
    y <= viewport.y + viewport.height + margin
  );
}

/**
 * The range of tiles that could intersect a viewport.
 *
 * Cheaper than testing every tile in a large city: converts the viewport's
 * four screen corners into tile space and takes the bounding range, clamped
 * to the grid.
 */
export function visibleTileRange(
  viewport: Rect,
  gridW: number,
  gridH: number,
  margin = TILE_W * 2,
): { minX: number; maxX: number; minY: number; maxY: number } {
  const corners: Point[] = [
    { x: viewport.x - margin, y: viewport.y - margin },
    { x: viewport.x + viewport.width + margin, y: viewport.y - margin },
    { x: viewport.x - margin, y: viewport.y + viewport.height + margin },
    { x: viewport.x + viewport.width + margin, y: viewport.y + viewport.height + margin },
  ];

  const tiles = corners.map((c) => screenToTile(c.x, c.y));
  const xs = tiles.map((t) => t.x);
  const ys = tiles.map((t) => t.y);

  return {
    minX: Math.max(0, Math.min(...xs)),
    maxX: Math.min(gridW - 1, Math.max(...xs)),
    minY: Math.max(0, Math.min(...ys)),
    maxY: Math.min(gridH - 1, Math.max(...ys)),
  };
}

/**
 * Snap to whole pixels.
 *
 * A sprite drawn at x: 12.4 is a blurry sprite. Every transform is rounded
 * before it reaches the DOM.
 */
export function snap(value: number): number {
  return Math.round(value);
}

/** Zoom is clamped to integer steps so pixel art never resamples. */
export const ZOOM_STEPS = [1, 2, 3] as const;
export type Zoom = (typeof ZOOM_STEPS)[number];

export function clampZoom(zoom: number): Zoom {
  let closest: Zoom = ZOOM_STEPS[0];
  for (const step of ZOOM_STEPS) {
    if (Math.abs(step - zoom) < Math.abs(closest - zoom)) closest = step;
  }
  return closest;
}

/** Step one notch in or out, staying on the integer ladder. */
export function stepZoom(zoom: Zoom, direction: 1 | -1): Zoom {
  const index = ZOOM_STEPS.indexOf(zoom);
  const next = Math.min(ZOOM_STEPS.length - 1, Math.max(0, index + direction));
  return ZOOM_STEPS[next] ?? zoom;
}

/** Is a tile inside a neighbourhood's rectangular region? */
export function isInRegion(
  tileX: number,
  tileY: number,
  region: { origin_x: number; origin_y: number; width: number; height: number },
): boolean {
  return (
    tileX >= region.origin_x &&
    tileX < region.origin_x + region.width &&
    tileY >= region.origin_y &&
    tileY < region.origin_y + region.height
  );
}
