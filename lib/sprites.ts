/**
 * The sprite registry.
 *
 * The single typed map from a building's `sprite_key` + variant + state to the
 * geometry that draws it. No component ever names a sprite by path or
 * hand-rolls a polygon: re-arting Burg means editing this file only.
 *
 * Geometry is generated rather than hand-drawn per size because a building's
 * silhouette is a function of its footprint and floor count. Every coordinate
 * is in the sprite's local space, whose origin is the footprint's TOP vertex
 * (the same point `tileToScreen` returns), with negative y going up.
 *
 * Colours are CSS custom properties, never literals -- the biome the sprite
 * sits in decides them.
 */

import { TILE_H, TILE_W } from "./iso";
import type { Database } from "./database.types";

export type ArtifactType = Database["public"]["Enums"]["artifact_type"];
export type SpriteVariant = 1 | 2 | 3;
export type SpriteState = "idle" | "hover" | "ghost" | "construction" | "boarded";

export type SpriteKey = "library" | "warehouse" | "noticeboard" | "newsstand" | "studio" | "hoarding";

/** A building's type decides its silhouette. The sprite IS the schema. */
export const SPRITE_FOR_TYPE: Record<ArtifactType, SpriteKey> = {
  doc: "library",
  table: "warehouse",
  board: "noticeboard",
  canvas: "studio",
  kiosk: "newsstand",
};

const HALF_W = TILE_W / 2; // 32
const HALF_H = TILE_H / 2; // 16

/** Height of one storey, in pixels. A multiple of 4 keeps edges on-grid. */
const FLOOR_H = 20;
const ROOF_H = 12;

export type Shape = {
  points: string;
  fill: string;
  /** Drawn with the hard 1px ink outline shared by every sprite face. */
  stroke?: boolean;
};

export type SpriteGeometry = {
  /** SVG viewBox and the element's pixel size at 1x zoom. */
  viewBox: string;
  width: number;
  height: number;
  /**
   * Where the sprite's local origin sits inside the element, so the renderer
   * can line the footprint's top vertex up with tileToScreen().
   */
  originX: number;
  originY: number;
  shapes: Shape[];
};

type Vec = { x: number; y: number };
const pts = (...v: Vec[]) => v.map((p) => `${p.x},${p.y}`).join(" ");

/** The four corners of a w x h footprint diamond, at a given height offset. */
function diamond(w: number, h: number, lift = 0) {
  return {
    top: { x: 0, y: -lift },
    right: { x: w * HALF_W, y: w * HALF_H - lift },
    bottom: { x: (w - h) * HALF_W, y: (w + h) * HALF_H - lift },
    left: { x: -h * HALF_W, y: h * HALF_H - lift },
  };
}

/**
 * The shared box: a footprint diamond extruded upward, with the two viewer-
 * facing wall panels and a hipped roof. Every building type starts here and
 * adds its own details on top.
 */
function boxShapes(w: number, h: number, floors: number): Shape[] {
  const wallH = floors * FLOOR_H;
  const base = diamond(w, h, 0);
  const top = diamond(w, h, wallH);

  // Roof apex sits above the centre of the raised diamond.
  const apex = {
    x: (w - h) * HALF_W / 2,
    y: (w + h) * HALF_H / 2 - wallH - ROOF_H,
  };

  return [
    // Left wall (in shadow), then right wall (lit).
    { points: pts(base.left, base.bottom, top.bottom, top.left), fill: "var(--face-wall-shade)", stroke: true },
    { points: pts(base.bottom, base.right, top.right, top.bottom), fill: "var(--face-wall-lit)", stroke: true },
    // Hipped roof: only the two front faces are ever visible.
    { points: pts(top.left, top.bottom, apex), fill: "var(--face-roof-shade)", stroke: true },
    { points: pts(top.bottom, top.right, apex), fill: "var(--face-roof-lit)", stroke: true },
  ];
}

/** Per-type detail, drawn over the shared box. */
function detailShapes(key: SpriteKey, variant: SpriteVariant, w: number, h: number, floors: number): Shape[] {
  const wallH = floors * FLOOR_H;
  const base = diamond(w, h, 0);
  const top = diamond(w, h, wallH);

  switch (key) {
    case "library": {
      // Tall windows marching along the lit face, one per storey.
      const shapes: Shape[] = [];
      const span = { x: base.right.x - base.bottom.x, y: base.right.y - base.bottom.y };
      const count = variant === 1 ? 2 : variant === 2 ? 3 : 4;
      for (let i = 0; i < count; i++) {
        const u0 = (i + 0.5) / (count + 0.4);
        const uw = 0.34 / count;
        const at = (u: number, lift: number): Vec => ({
          x: base.bottom.x + span.x * u,
          y: base.bottom.y + span.y * u - lift,
        });
        shapes.push({
          points: pts(at(u0, wallH * 0.28), at(u0 + uw, wallH * 0.28), at(u0 + uw, wallH * 0.78), at(u0, wallH * 0.78)),
          fill: "var(--face-accent)",
          stroke: true,
        });
      }
      return shapes;
    }

    case "warehouse": {
      // One wide loading door, and a band along the eaves.
      const span = { x: base.right.x - base.bottom.x, y: base.right.y - base.bottom.y };
      const at = (u: number, lift: number): Vec => ({
        x: base.bottom.x + span.x * u,
        y: base.bottom.y + span.y * u - lift,
      });
      return [
        {
          points: pts(at(0.18, 0), at(0.62, 0), at(0.62, wallH * 0.62), at(0.18, wallH * 0.62)),
          fill: "var(--face-roof-shade)",
          stroke: true,
        },
        {
          points: pts(at(0.05, wallH * 0.78), at(0.95, wallH * 0.78), at(0.95, wallH * 0.9), at(0.05, wallH * 0.9)),
          fill: "var(--face-accent)",
          stroke: true,
        },
      ];
    }

    case "newsstand": {
      // A striped awning cantilevered over the lit face.
      const span = { x: base.right.x - base.bottom.x, y: base.right.y - base.bottom.y };
      const at = (u: number, lift: number): Vec => ({
        x: base.bottom.x + span.x * u,
        y: base.bottom.y + span.y * u - lift,
      });
      return [
        {
          points: pts(at(0, wallH * 0.62), at(1, wallH * 0.62), at(1.08, wallH * 0.5), at(0.08, wallH * 0.5)),
          fill: "var(--face-accent)",
          stroke: true,
        },
        {
          points: pts(at(0.2, 0), at(0.8, 0), at(0.8, wallH * 0.45), at(0.2, wallH * 0.45)),
          fill: "var(--face-roof-shade)",
          stroke: true,
        },
      ];
    }

    case "studio": {
      // A north-light skylight sawtooth across the roof.
      return [
        {
          points: pts(top.left, top.bottom, { x: top.bottom.x, y: top.bottom.y - ROOF_H }, { x: top.left.x, y: top.left.y - ROOF_H }),
          fill: "var(--color-sky)",
          stroke: true,
        },
      ];
    }

    case "noticeboard": {
      // Not a box at all: two posts and a board, standing on the tile.
      const boardW = 34;
      const boardH = 26;
      const postH = 16;
      const cx = (w - h) * HALF_W / 2;
      const cy = (w + h) * HALF_H / 2;
      return [
        { points: pts({ x: cx - 12, y: cy }, { x: cx - 8, y: cy }, { x: cx - 8, y: cy - postH }, { x: cx - 12, y: cy - postH }), fill: "var(--face-wall-shade)", stroke: true },
        { points: pts({ x: cx + 8, y: cy }, { x: cx + 12, y: cy }, { x: cx + 12, y: cy - postH }, { x: cx + 8, y: cy - postH }), fill: "var(--face-wall-shade)", stroke: true },
        {
          points: pts(
            { x: cx - boardW / 2, y: cy - postH },
            { x: cx + boardW / 2, y: cy - postH },
            { x: cx + boardW / 2, y: cy - postH - boardH },
            { x: cx - boardW / 2, y: cy - postH - boardH },
          ),
          fill: "var(--color-dust)",
          stroke: true,
        },
        // Three pinned notes, so the board reads as used.
        { points: pts({ x: cx - 12, y: cy - postH - 20 }, { x: cx - 3, y: cy - postH - 20 }, { x: cx - 3, y: cy - postH - 11 }, { x: cx - 12, y: cy - postH - 11 }), fill: "var(--color-gold)", stroke: true },
        { points: pts({ x: cx + 1, y: cy - postH - 22 }, { x: cx + 10, y: cy - postH - 22 }, { x: cx + 10, y: cy - postH - 13 }, { x: cx + 1, y: cy - postH - 13 }), fill: "var(--color-rose)", stroke: true },
        { points: pts({ x: cx - 6, y: cy - postH - 9 }, { x: cx + 4, y: cy - postH - 9 }, { x: cx + 4, y: cy - postH - 3 }, { x: cx - 6, y: cy - postH - 3 }), fill: "var(--color-sky)", stroke: true },
      ];
    }

    case "hoarding": {
      // The Studio's stand-in until Phase 7: a fenced construction site.
      const shapes: Shape[] = [];
      const span = { x: base.right.x - base.bottom.x, y: base.right.y - base.bottom.y };
      for (let i = 0; i < 5; i++) {
        const u = i / 5 + 0.06;
        const at = (uu: number, lift: number): Vec => ({
          x: base.bottom.x + span.x * uu,
          y: base.bottom.y + span.y * uu - lift,
        });
        shapes.push({
          points: pts(at(u, 0), at(u + 0.1, 0), at(u + 0.1, 22), at(u, 22)),
          fill: i % 2 === 0 ? "var(--color-amber)" : "var(--color-ink)",
          stroke: true,
        });
      }
      return shapes;
    }
  }
}

/**
 * Build the geometry for one building.
 *
 * `state` only affects colour and offset at render time, so it is not part of
 * the geometry cache key.
 */
export function buildingSprite(
  key: SpriteKey,
  variant: SpriteVariant,
  footprintW: number,
  footprintH: number,
  floors: number,
): SpriteGeometry {
  const w = footprintW;
  const h = footprintH;
  const isBox = key !== "noticeboard";
  const wallH = isBox ? floors * FLOOR_H : 0;
  const roofH = isBox ? ROOF_H : 46; // the noticeboard's posts + board

  const shapes = [
    ...(isBox ? boxShapes(w, h, floors) : []),
    ...detailShapes(key, variant, w, h, floors),
  ];

  const width = (w + h) * HALF_W;
  const height = (w + h) * HALF_H + wallH + roofH;
  const originX = h * HALF_W;
  const originY = wallH + roofH;

  return {
    viewBox: `${-originX} ${-originY} ${width} ${height}`,
    width,
    height,
    originX,
    originY,
    shapes,
  };
}

/** Ground tile diamonds, one per terrain. */
export type Terrain = Database["public"]["Enums"]["terrain"];

export const TERRAIN_FILL: Record<Terrain, string> = {
  grass: "var(--face-ground-lit)",
  cobble: "var(--face-ground-shade)",
  water: "var(--color-water)",
  park: "var(--color-lime)",
  road: "var(--color-dust)",
};

/** The tile diamond, in a 64x32 box with its top vertex at (32, 0). */
export const TILE_DIAMOND = `${HALF_W},0 ${TILE_W},${HALF_H} ${HALF_W},${TILE_H} 0,${HALF_H}`;
