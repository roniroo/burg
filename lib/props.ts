/**
 * Where street furniture stands.
 *
 * Props have no table behind them. Rather than store a row per lamp post, the
 * scatter is a pure function of the tile's coordinates and the city's seed, so
 * it is identical on every render, on every client, and after a reload --
 * which is the only property that matters for something purely decorative.
 *
 * The trade is that nobody can place a lamp where they want one. When that is
 * worth having, this function becomes the fallback for a `prop` column on
 * `tiles` rather than being replaced by it.
 *
 * Pure and DOM-free, like the rest of lib/.
 */

import type { PropKey } from "./sprites";

/**
 * The scatter's vocabulary, listed with repeats to weight it: lamps and trees
 * are what a street is mostly made of, and a signpost is an event.
 *
 * The fountain is deliberately absent. It reads as a plaza centrepiece, and
 * one appearing at random in the middle of a row of houses looks like a bug.
 */
const SCATTER: PropKey[] = [
  "lamp", "lamp", "lamp",
  "tree", "tree", "tree", "tree",
  "bench", "bench",
  "planter", "planter",
  "hydrantpost",
  "crates",
  "sign",
];

/** Share of eligible tiles that get anything at all. Sparse on purpose. */
const DENSITY = 0.14;

/**
 * A 32-bit integer hash of (x, y, salt), returned as a fraction in [0, 1).
 *
 * Deterministic and well-mixed enough that neighbouring tiles do not correlate
 * -- an ordinary `sin` hash bands badly along the axes, which on a grid reads
 * as rows of identical lamp posts.
 */
function hash(x: number, y: number, salt: number): number {
  let h = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(salt | 0, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/**
 * The prop standing on a tile, or null for the great majority of them.
 *
 * The caller decides which tiles are eligible at all -- a prop never shares a
 * tile with a building, a road or water.
 */
export function propAt(x: number, y: number, seed = 0): PropKey | null {
  if (hash(x, y, seed) >= DENSITY) return null;
  const pick = Math.floor(hash(x, y, seed + 0x9e37) * SCATTER.length);
  return SCATTER[pick] ?? null;
}
