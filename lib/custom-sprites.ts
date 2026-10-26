/**
 * Sprites you draw yourself: the maths, kept pure.
 *
 * A custom sprite is a PNG and the lot it is drawn for. It is laid out the way
 * the built-in art is: exactly as wide as its lot, with the bottom of the image
 * on the lot's bottom corner, so a tall building simply grows upward. Drawn at
 * the map's own scale -- 64 pixels across per tile -- or at an exact multiple of
 * it, every pixel lands on a pixel; any other size still works, smoothed.
 *
 * No DOM and no database here, which is why it carries the unit tests. The
 * uploader reads pixels with a canvas and hands them to `hitAreaFromPixels`;
 * the server checks what arrives with `pngSize` and `parseHitArea`.
 */

import { TILE_H, TILE_W, tileToScreen, type Point } from "./iso";

export const MAX_SPRITE_BYTES = 5 * 1024 * 1024;
export const MAX_SPRITE_SIDE = 2048;
/** The largest lot, per side, that the buildings table allows. */
export const MAX_FOOTPRINT = 4;

/** What the map needs to draw one. The image itself is fetched by id. */
export type CustomSpriteMeta = {
  id: string;
  name: string;
  width: number;
  height: number;
  footprint_w: number;
  footprint_h: number;
  hit_area: string;
};

export function customSpriteUrl(id: string): string {
  return `/api/sprites/${id}`;
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/**
 * The size a PNG says it is, or null if the bytes are not a PNG.
 *
 * The first chunk of every PNG is IHDR, and its first eight bytes are the
 * width and height, big-endian. That is all the server needs to check an
 * upload against what the browser measured, without decoding the image.
 */
export function pngSize(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 24) return null;
  if (!PNG_SIGNATURE.every((b, i) => bytes[i] === b)) return null;
  const chunk = String.fromCharCode(...bytes.subarray(12, 16));
  if (chunk !== "IHDR") return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

/**
 * A first guess at a square lot from an image's width.
 *
 * A square lot of n by n tiles is 64·n pixels wide at the map's scale -- it
 * spans n + n half-tiles of 32 -- and art drawn at 2x or 3x is a multiple of
 * that. The first scale that divides evenly wins; failing that, the nearest
 * size, clamped to what the map allows.
 */
export function suggestFootprint(width: number): number {
  for (const scale of [1, 2, 3, 4]) {
    const tiles = width / (TILE_W * scale);
    if (Number.isInteger(tiles) && tiles >= 1 && tiles <= MAX_FOOTPRINT) return tiles;
  }
  return Math.min(MAX_FOOTPRINT, Math.max(1, Math.round(width / TILE_W)));
}

export type SpriteLayout = {
  /** On-map size in CSS pixels. */
  width: number;
  height: number;
  /** Where the lot's top vertex -- tileToScreen's point -- sits in the box. */
  originX: number;
  originY: number;
  /** True when every image pixel lands on whole map pixels. */
  crisp: boolean;
};

/**
 * Where a sprite goes on its lot.
 *
 * In sprite-local space, with the lot's top vertex at the origin as every
 * sprite in lib/sprites.ts uses, a lot of w by h tiles runs from -h·32 on the
 * left to w·32 on the right, and its bottom corner is at y = (w + h)·16. The
 * image fills that width and stands on that corner.
 */
export function spriteLayout(sprite: Pick<CustomSpriteMeta, "width" | "height" | "footprint_w" | "footprint_h">): SpriteLayout {
  const { footprint_w: w, footprint_h: h } = sprite;
  const lotWidth = (w + h) * (TILE_W / 2);
  const height = Math.round((sprite.height * lotWidth) / sprite.width);
  return {
    width: lotWidth,
    height,
    originX: h * (TILE_W / 2),
    originY: height - (w + h) * (TILE_H / 2),
    crisp: lotWidth % sprite.width === 0 || sprite.width % lotWidth === 0,
  };
}

/**
 * The outline of a sprite's opaque pixels, as "x,y x,y ...".
 *
 * A convex hull rather than a pixel-exact trace: it is what a click should
 * land on, an isometric building is close to convex anyway, and a hull is a
 * handful of points where a trace of a large image is thousands. Faint pixels
 * -- a soft shadow, a glow -- are below `threshold` and do not count.
 *
 * `rgba` is ImageData's layout: four bytes a pixel, alpha last. Null when no
 * pixel is opaque enough to click.
 */
export function hitAreaFromPixels(rgba: ArrayLike<number>, width: number, height: number, threshold = 32): string | null {
  const points: Point[] = [];
  for (let y = 0; y < height; y++) {
    let left = -1;
    let right = -1;
    for (let x = 0; x < width; x++) {
      if ((rgba[(y * width + x) * 4 + 3] ?? 0) >= threshold) {
        if (left < 0) left = x;
        right = x;
      }
    }
    // Pixel corners, not centres, so a one-pixel row still has area.
    if (left >= 0) points.push({ x: left, y }, { x: left, y: y + 1 }, { x: right + 1, y }, { x: right + 1, y: y + 1 });
  }
  if (points.length === 0) return null;
  return convexHull(points)
    .map((p) => `${p.x},${p.y}`)
    .join(" ");
}

/** Andrew's monotone chain. Collinear points are dropped. */
function convexHull(input: Point[]): Point[] {
  const points = [...input].sort((a, b) => a.x - b.x || a.y - b.y);
  const cross = (o: Point, a: Point, b: Point) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);

  const lower: Point[] = [];
  for (const p of points) {
    while (lower.length >= 2 && cross(lower[lower.length - 2]!, lower[lower.length - 1]!, p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: Point[] = [];
  for (const p of [...points].reverse()) {
    while (upper.length >= 2 && cross(upper[upper.length - 2]!, upper[upper.length - 1]!, p) <= 0) upper.pop();
    upper.push(p);
  }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

/**
 * Check a hit area that arrived from the browser: at least three points, all
 * numbers, all inside the image. Returns it normalised, or null.
 */
export function parseHitArea(text: string, width: number, height: number): string | null {
  const pairs = text.trim().split(/\s+/);
  if (pairs.length < 3 || pairs.length > 4096) return null;
  const out: string[] = [];
  for (const pair of pairs) {
    const match = /^(\d+),(\d+)$/.exec(pair);
    if (!match) return null;
    const x = Number(match[1]);
    const y = Number(match[2]);
    if (x > width || y > height) return null;
    out.push(`${x},${y}`);
  }
  return out.join(" ");
}

/**
 * The tile diamonds of a lot, drawn on an image of the lot's native width and
 * the given height -- the guide the template download is made of. Each entry
 * is one tile's corners in image pixels, top, right, bottom, left.
 */
export function lotTiles(footprintW: number, footprintH: number, imageHeight: number): Point[][] {
  const originX = footprintH * (TILE_W / 2);
  const originY = imageHeight - (footprintW + footprintH) * (TILE_H / 2);
  const tiles: Point[][] = [];
  for (let ty = 0; ty < footprintH; ty++) {
    for (let tx = 0; tx < footprintW; tx++) {
      const top = tileToScreen(tx, ty);
      tiles.push(
        [
          top,
          { x: top.x + TILE_W / 2, y: top.y + TILE_H / 2 },
          { x: top.x, y: top.y + TILE_H },
          { x: top.x - TILE_W / 2, y: top.y + TILE_H / 2 },
        ].map((p) => ({ x: p.x + originX, y: p.y + originY })),
      );
    }
  }
  return tiles;
}

/** Room above the lot in a template: about four storeys and a roof. */
export const TEMPLATE_HEADROOM = 96;
