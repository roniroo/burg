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
 * (the same point `tileToScreen` returns), with negative y going up, and every
 * coordinate is rounded at construction so a sprite is pixel-exact before any
 * transform touches it.
 *
 * Colours are CSS custom properties, never literals -- the biome the sprite
 * sits in decides them, and [data-lamps="on"] lights every window at once.
 */

import { TILE_W, TILE_H } from "./iso";
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

export type Shape = {
  points: string;
  fill: string;
  /** Drawn with the hard 1px ink outline shared by every sprite face. */
  stroke?: boolean;
  /** Ghost previews only. */
  opacity?: number;
  dash?: string;
};

export type SpriteGeometry = {
  viewBox: string;
  width: number;
  height: number;
  /** Where the local origin sits inside the element, so the renderer can line
   *  the footprint's top vertex up with tileToScreen(). */
  originX: number;
  originY: number;
  shapes: Shape[];
  /** Chimney puffs, so the caller can animate them as one group and stop
   *  under prefers-reduced-motion. */
  smoke: Shape[];
};

type Vec = { x: number; y: number };
type Face = "lit" | "shade";

const HW = TILE_W / 2; // 32
const HH = TILE_H / 2; // 16

/** Height of one storey, in pixels. A multiple of 4 keeps edges on-grid. */
export const FLOOR_H = 20;

const R = Math.round;
const P = (x: number, y: number): Vec => ({ x: R(x), y: R(y) });
const pts = (...v: Vec[]) => v.map((p) => `${p.x},${p.y}`).join(" ");
const S = (points: string, fill: string, stroke?: boolean, extra?: Partial<Shape>): Shape => ({
  points,
  fill,
  stroke: stroke !== false,
  ...extra,
});

/**
 * Derive a colour the way globals.css does, so a sprite never authors a hex
 * and never reaches past its biome for one.
 */
const mix = (a: string, b: string, pct: number) => `color-mix(in srgb, ${a} ${pct}%, ${b})`;

/**
 * Every colour a sprite may ask for. Each is a token declared in globals.css
 * under :root, [data-biome] -- the district decides what they mean, and the
 * day/night cycle re-points --face-glass and friends without a second set of
 * sprites.
 */
export const C = {
  ink: "var(--color-ink)",
  paper: "var(--color-paper)",
  stone: "var(--color-stone)",

  wallLit: "var(--face-wall-lit)",
  wallMid: "var(--face-wall-mid)",
  wallShade: "var(--face-wall-shade)",
  roofLit: "var(--face-roof-lit)",
  roofMid: "var(--face-roof-mid)",
  roofShade: "var(--face-roof-shade)",
  groundLit: "var(--face-ground-lit)",
  groundMid: "var(--face-ground-mid)",
  groundShade: "var(--face-ground-shade)",
  groundAlt: "var(--biome-ground-alt)",
  edge: "var(--biome-edge)",
  accent: "var(--face-accent)",

  trim: "var(--face-trim)",
  glass: "var(--face-glass)",
  glassDeep: "var(--face-glass-deep)",
  glassBar: "var(--face-glass-bar)",
  metal: "var(--face-metal)",
  metalDark: "var(--face-metal-dark)",
  timber: "var(--face-timber)",
  timberDark: "var(--face-timber-dark)",
  leaf: "var(--face-leaf)",
  leafDark: "var(--face-leaf-dark)",
  bloom: "var(--face-bloom)",
  water: "var(--color-water)",
  waterLit: mix("var(--color-sky)", "var(--color-water)", 55),
  shadow: "var(--face-shadow)",
  smoke: "var(--color-mist)",
  signA: "var(--sign-plate)",
  signB: "var(--sign-ink)",
} as const;

type Palette = typeof C;
type Frame = ReturnType<typeof frame>;
type Recipe = {
  name: string;
  sub: string;
  w: number;
  h: number;
  floors: number;
  build: (f: Frame) => { shapes: Shape[]; smoke?: Shape[] };
};

/* ── primitives ──────────────────────────────────────────────────────── */

function diamond(w: number, h: number, lift = 0) {
  return {
    top: P(0, -lift),
    right: P(w * HW, w * HH - lift),
    bottom: P((w - h) * HW, (w + h) * HH - lift),
    left: P(-h * HW, h * HH - lift),
  };
}
/** Grow a footprint diamond outward by `px` on every side (roof overhang). */
function grow(w: number, h: number, lift: number, px: number) {
  const eu = px / TILE_W;
  const d = diamond(w + 2 * eu, h + 2 * eu, lift);
  const dy = -2 * eu * HH;
  return { top: P(d.top.x, d.top.y + dy), right: P(d.right.x, d.right.y + dy), bottom: P(d.bottom.x, d.bottom.y + dy), left: P(d.left.x, d.left.y + dy) };
}
const mid2 = (a: Vec, b: Vec) => P((a.x + b.x) / 2, (a.y + b.y) / 2);
const up = (v: Vec, y: number): Vec => P(v.x, v.y - y);

/** Everything a building generator needs, in one object. */
function frame(w: number, h: number, floors: number) {
  const wallH = floors * FLOOR_H;
  const base = diamond(w, h, 0);
  const top = diamond(w, h, wallH);
  /** u,v as fractions of the footprint; y is pixels up from the ground. */
  const plane = (u: number, v: number, y = 0): Vec => P((u * w - v * h) * HW, (u * w + v * h) * HH - y);
  /** Same, but on the roof's grown diamond — the surface a roof helper drew. */
  const gplane = (u: number, v: number, y = 0, over = 0): Vec => {
    const eu = over / TILE_W, gw = w + 2 * eu, gh = h + 2 * eu;
    return P((u * gw - v * gh) * HW, (u * gw + v * gh) * HH - y - 2 * eu * HH);
  };
  /** the lit (lower-right) wall, u along it, y up from its base */
  const L = (u: number, y = 0): Vec => P(base.bottom.x + (base.right.x - base.bottom.x) * u, base.bottom.y + (base.right.y - base.bottom.y) * u - y);
  /** the shaded (lower-left) wall */
  const D = (u: number, y = 0): Vec => P(base.left.x + (base.bottom.x - base.left.x) * u, base.left.y + (base.bottom.y - base.left.y) * u - y);
  const LQ = (u0: number, u1: number, y0: number, y1: number) => pts(L(u0, y0), L(u1, y0), L(u1, y1), L(u0, y1));
  const DQ = (u0: number, u1: number, y0: number, y1: number) => pts(D(u0, y0), D(u1, y0), D(u1, y1), D(u0, y1));
  return { w, h, floors, wallH, base, top, plane, gplane, L, D, LQ, DQ };
}

/** A small iso box standing on (cx, cy): crates, chimneys, tanks, plinths. */
function propBox(cx: number, cy: number, a: number, b: number, hgt: number, p: Palette, fills: { left?: string; right?: string; top?: string } = {}): Shape[] {
  const l = fills.left || p.timberDark, r = fills.right || p.timber, t = fills.top || p.timber;
  const bb = P(cx, cy + b), bl = P(cx - a, cy), br = P(cx + a, cy);
  const tt = P(cx, cy - b - hgt), tb = P(cx, cy + b - hgt), tl = P(cx - a, cy - hgt), tr = P(cx + a, cy - hgt);
  return [S(pts(bl, bb, tb, tl), l), S(pts(bb, br, tr, tb), r), S(pts(tt, tr, tb, tl), t)];
}

function octagon(cx: number, cy: number, rx: number, ry: number) {
  const k = 0.4142;
  const v = [
    P(cx - rx * k, cy - ry), P(cx + rx * k, cy - ry), P(cx + rx, cy - ry * k), P(cx + rx, cy + ry * k),
    P(cx + rx * k, cy + ry), P(cx - rx * k, cy + ry), P(cx - rx, cy + ry * k), P(cx - rx, cy - ry * k),
  ];
  return pts(...v);
}

/**
 * An upright cylinder in iso: bottom disc, side band, top disc. Drawing the
 * discs OVER the band is what gives the drum its curved ends — a flat-bottomed
 * polygon is the thing that reads as a hexagon.
 */
function cylinder(cx: number, cy: number, r: number, hgt: number, p: Palette, fills: { side?: string; shade?: string; hi?: string; top?: string; foot?: string } = {}): { ry: number; shapes: Shape[] } {
  const ry = Math.max(4, Math.round(r * 0.52));
  const side = fills.side || p.metal;
  return {
    ry,
    shapes: [
      S(octagon(cx, cy, r, ry), fills.foot || mix(side, p.ink, 78)),
      S(pts(P(cx - r, cy - hgt), P(cx + r, cy - hgt), P(cx + r, cy), P(cx - r, cy)), side, false),
      S(pts(P(cx - r, cy - hgt), P(cx - r + Math.round(r * 0.45), cy - hgt), P(cx - r + Math.round(r * 0.45), cy), P(cx - r, cy)), fills.shade || mix(side, p.ink, 74), false),
      S(pts(P(cx + r - Math.round(r * 0.3), cy - hgt), P(cx + r, cy - hgt), P(cx + r, cy), P(cx + r - Math.round(r * 0.3), cy)), fills.hi || mix(side, p.paper, 78), false),
      S(octagon(cx, cy - hgt, r, ry), fills.top || mix(side, p.paper, 66)),
    ],
  };
}

/** A cone sitting on a rim of radius r: the roof of a drum. */
function cone(cx: number, cy: number, r: number, hgt: number, lit: string, shade: string): Shape[] {
  const ry = Math.max(4, Math.round(r * 0.52));
  const left = P(cx - r, cy);
  const leftMid = P(cx - r * 0.55, cy + ry * 0.85);
  const foot = P(cx, cy + ry);
  const rightMid = P(cx + r * 0.55, cy + ry * 0.85);
  const right = P(cx + r, cy);
  const apex = P(cx, cy - hgt);
  return [
    S(pts(apex, left, leftMid, foot, rightMid, right), lit),
    S(pts(apex, left, leftMid, foot), shade, false),
  ];
}

/** A band of poster wrapped round a drum: its edges bow with the curve. */
function wrap(cx: number, base: number, x0: number, x1: number, y0: number, y1: number, fill: string): Shape {
  const bow = (x: number) => Math.round(2 * (1 - Math.pow((x - (x0 + x1) / 2) / ((x1 - x0) / 2 || 1), 2)));
  const m = (x0 + x1) / 2;
  return S(pts(
    P(cx + x0, base - y1), P(cx + m, base - y1 + bow(m)), P(cx + x1, base - y1),
    P(cx + x1, base - y0), P(cx + m, base - y0 + bow(m)), P(cx + x0, base - y0),
  ), fill, false);
}

/**
 * An upright panel whose baseline runs along the +x iso axis. Returns the
 * parametric point function plus the quad builder, so notes pinned to it
 * inherit the same projection.
 */
function panel(cx: number, cy: number, halfLen: number, opts: { off?: Vec } = {}) {
  const A = P(cx - halfLen, cy - halfLen / 2), B = P(cx + halfLen, cy + halfLen / 2);
  const at = (t: number, y: number): Vec => P(A.x + (B.x - A.x) * t, A.y + (B.y - A.y) * t - y);
  const q = (t0: number, t1: number, y0: number, y1: number) => pts(at(t0, y0), at(t1, y0), at(t1, y1), at(t0, y1));
  const off = opts.off || P(-6, 3);
  return { A, B, at, q, off };
}

/** A fascia sign: a plate lying flat ON a wall face, with its own frame. */
function faceSign(f: Frame, p: Palette, face: Face, u0: number, u1: number, y0: number, y1: number, words = [0.2, 0.28, 0.15]): Shape[] {
  const Q = face === "lit" ? f.LQ : f.DQ;
  const s: Shape[] = [S(Q(u0 - 0.014, u1 + 0.014, y0 - 2, y1 + 2), p.trim)];
  s.push(S(Q(u0, u1, y0, y1), p.signA, false));
  const my = (y0 + y1) / 2;
  let u = u0 + 0.025;
  for (const w of words) {
    if (u + w > u1 - 0.025) break;
    s.push(S(Q(u, u + w, my - 1.5, my + 1.5), p.signB, false));
    u += w + 0.03;
  }
  return s;
}

/** Cast shadow: the footprint, offset hard by 2px. Elevation, Burg-style. */
function castShadow(f: Frame, p: Palette, dx = 2, dy = 2): Shape[] {
  const d = f.base;
  return [S(pts(P(d.top.x + dx, d.top.y + dy), P(d.right.x + dx, d.right.y + dy), P(d.bottom.x + dx, d.bottom.y + dy), P(d.left.x + dx, d.left.y + dy)), p.shadow, false)];
}

/* ── shells ──────────────────────────────────────────────────────────── */

/** Two visible wall panels plus a 3px mid-tone band under the eaves. */
function walls(f: Frame, p: Palette, opts: { band?: boolean; plinth?: boolean; lit?: string; shade?: string; bandLit?: string; bandShade?: string } = {}): Shape[] {
  const { base, top, wallH } = f;
  const bandY = opts.band === false ? null : wallH - 4;
  const sh = [
    S(pts(base.left, base.bottom, top.bottom, top.left), opts.shade || p.wallShade),
    S(pts(base.bottom, base.right, top.right, top.bottom), opts.lit || p.wallLit),
  ];
  if (bandY !== null) {
    sh.push(S(f.DQ(0, 1, bandY, wallH), opts.bandShade ?? mix(p.wallMid, p.ink, 82), false));
    sh.push(S(f.LQ(0, 1, bandY, wallH), opts.bandLit || p.wallMid, false));
  }
  /** ground line: a 2px plinth keeps buildings from floating */
  if (opts.plinth !== false) {
    sh.push(S(f.DQ(0, 1, 0, 3), mix(p.wallShade, p.ink, 78), false));
    sh.push(S(f.LQ(0, 1, 0, 3), mix(p.wallLit, p.ink, 78), false));
  }
  return sh;
}

function hipRoof(f: Frame, p: Palette, rh = 14, over = 5): Shape[] {
  const e = grow(f.w, f.h, f.wallH, over);
  const c = mid2(e.top, e.bottom);
  const apex = P(c.x, c.y - rh);
  return [
    S(pts(e.left, e.bottom, f.top.bottom, f.top.left), mix(p.roofShade, p.ink, 70), false),
    S(pts(f.top.bottom, f.top.right, e.right, e.bottom), mix(p.roofShade, p.ink, 78), false),
    S(pts(e.left, e.bottom, apex), p.roofShade),
    S(pts(e.bottom, e.right, apex), p.roofLit),
    S(pts(mid2(e.left, apex), mid2(e.right, apex), apex), p.roofMid, false),
  ];
}

function gableRoof(f: Frame, p: Palette, rh = 18, over = 5): Shape[] {
  const e = grow(f.w, f.h, f.wallH, over);
  const m1 = up(mid2(e.top, e.left), rh), m2 = up(mid2(e.right, e.bottom), rh);
  return [
    S(pts(e.top, e.right, m2, m1), p.roofMid),
    S(pts(e.left, e.bottom, m2, m1), p.roofShade),
    S(pts(e.right, e.bottom, m2), p.wallMid),
    S(pts(m1, m2, P(m2.x, m2.y + 3), P(m1.x, m1.y + 3)), mix(p.roofLit, p.paper, 55), false),
  ];
}

function flatRoof(f: Frame, p: Palette, ph = 8, over = 3): Shape[] {
  const e = grow(f.w, f.h, f.wallH, over);
  const t = { top: up(e.top, ph), right: up(e.right, ph), bottom: up(e.bottom, ph), left: up(e.left, ph) };
  return [
    S(pts(e.top, e.right, e.bottom, e.left), mix(p.roofShade, p.ink, 88), false),
    S(pts(t.top, t.right, t.bottom, t.left), p.roofMid),
    S(pts(e.left, e.bottom, t.bottom, t.left), p.roofShade),
    S(pts(e.bottom, e.right, t.right, t.bottom), p.roofLit),
    S(pts(up(t.left, 0), up(t.bottom, 0), up(t.bottom, 2), up(t.left, 2)), mix(p.roofLit, p.paper, 60), false),
  ];
}

/* ── details ─────────────────────────────────────────────────────────── */

/** A window with a sill and a night interior. */
function windowLit(f: Frame, p: Palette, face: Face, u0: number, u1: number, y0: number, y1: number, opts: { mullion?: boolean; sill?: boolean; interior?: boolean } = {}): Shape[] {
  const Q = face === "lit" ? f.LQ : f.DQ;
  const dim = face === "lit" ? 1 : 0.84;
  const g = dim === 1 ? p.glass : mix(p.glass, p.ink, 88);
  const sh: Shape[] = [
    S(Q(u0 - 0.012, u1 + 0.012, y0 - 2, y1 + 2), p.trim),
    S(Q(u0, u1, y0, y1), g),
    S(Q(u0, u1, y1 - Math.max(3, (y1 - y0) * 0.22), y1), p.glassDeep, false),
  ];
  if (opts.mullion !== false) {
    const m = (u0 + u1) / 2;
    sh.push(S(Q(m - 0.006, m + 0.006, y0, y1), p.trim, false));
  }
  if (opts.interior) sh.push(S(Q(u0 + 0.02, u1 - 0.02, y0 + 2, y0 + 6), p.glassBar, false));
  if (opts.sill !== false) sh.push(S(Q(u0 - 0.03, u1 + 0.03, y0 - 4, y0 - 1), p.wallMid, false));
  return sh;
}

/** Window box: a trough on the sill and three blooms. */
function windowBox(f: Frame, p: Palette, face: Face, u0: number, u1: number, y: number): Shape[] {
  const Q = face === "lit" ? f.LQ : f.DQ;
  const P_ = face === "lit" ? f.L : f.D;
  const sh: Shape[] = [S(Q(u0 - 0.02, u1 + 0.02, y - 6, y - 1), p.timberDark)];
  const n = 3;
  for (let i = 0; i < n; i++) {
    const u = u0 + ((u1 - u0) * (i + 0.5)) / n;
    const a = P_(u, y + 1);
    sh.push(S(octagon(a.x, a.y - 2, 3, 2), i === 1 ? p.bloom : p.leaf, false));
  }
  return sh;
}

/** Awning: a canopy cantilevered off a face, striped. */
function awning(f: Frame, p: Palette, face: Face, u0: number, u1: number, y: number, proj = 12, stripes = 5): Shape[] {
  const P_ = face === "lit" ? f.L : f.D;
  const nx = face === "lit" ? 1 : -1;
  const o = (pt: Vec): Vec => P(pt.x + nx * proj, pt.y + proj * 0.5 + 2);
  const sh: Shape[] = [];
  for (let i = 0; i < stripes; i++) {
    const a = u0 + ((u1 - u0) * i) / stripes, b = u0 + ((u1 - u0) * (i + 1)) / stripes;
    const A = P_(a, y), B = P_(b, y);
    sh.push(S(pts(A, B, o(B), o(A)), i % 2 ? p.paper : p.accent, false));
  }
  sh.push(S(pts(P_(u0, y), P_(u1, y), o(P_(u1, y)), o(P_(u0, y))), "none"));
  const A = o(P_(u0, y)), B = o(P_(u1, y));
  sh.push(S(pts(A, B, P(B.x, B.y + 3), P(A.x, A.y + 3)), mix(p.accent, p.ink, 66), false));
  return sh;
}

/** Door plus a stoop and a doormat, on the ground in front of the face. */
function door(f: Frame, p: Palette, face: Face, u0: number, u1: number, hgt: number, opts: { fill?: string; stoop?: boolean; mat?: boolean } = {}): Shape[] {
  const Q = face === "lit" ? f.LQ : f.DQ;
  const P_ = face === "lit" ? f.L : f.D;
  const nx = face === "lit" ? 1 : -1;
  const sh: Shape[] = [
    S(Q(u0 - 0.014, u1 + 0.014, 0, hgt + 3), p.trim),
    S(Q(u0, u1, 0, hgt), opts.fill || p.timberDark),
    S(Q(u0 + 0.015, u1 - 0.015, hgt * 0.55, hgt * 0.86), p.glass, false),
  ];
  if (opts.stoop !== false) {
    const a = P_(u0 - 0.03, 0), b = P_(u1 + 0.03, 0);
    const oo = (pt: Vec, k: number): Vec => P(pt.x + nx * k, pt.y + k * 0.5);
    sh.unshift(S(pts(a, b, oo(b, 7), oo(a, 7)), p.stone));
    sh.unshift(S(pts(oo(a, 7), oo(b, 7), oo(b, 11), oo(a, 11)), opts.mat ? mix(p.accent, p.ink, 62) : mix(p.stone, p.ink, 80), false));
  }
  return sh;
}

/**
 * Height of the roof surface above the wall top, at (u, v).
 * Roof clutter is placed with this — a chimney planted at wallH floats over a
 * flat roof and sinks through a pitched one.
 */
export function roofY(kind: "hip" | "gable" | "flat", rh: number, u: number, v: number): number {
  if (kind === "flat") return rh;
  if (kind === "gable") return R(rh * (1 - Math.abs(2 * v - 1)));
  return R(rh * (1 - Math.max(Math.abs(2 * u - 1), Math.abs(2 * v - 1))));
}

function chimney(f: Frame, p: Palette, u: number, v: number, hgt = 16, smoke = true, lift = 0, over = 0): { shapes: Shape[]; smoke: Shape[] } {
  const b = f.gplane(u, v, f.wallH + lift, over);
  const sh = propBox(b.x, b.y, 6, 3, hgt, C, { left: mix(p.roofShade, p.ink, 74), right: p.roofShade, top: p.ink });
  const puffs: Shape[] = [];
  if (smoke) {
    for (let i = 0; i < 3; i++) {
      const s = 3 + i;
      const cx = b.x + i * 3, cy = b.y - hgt - 13 - i * 8;
      puffs.push(S(pts(P(cx - s, cy - s), P(cx + s, cy - s), P(cx + s, cy + s), P(cx - s, cy + s)), p.smoke, false, { opacity: 0.72 - i * 0.2 }));
    }
  }
  return { shapes: sh, smoke: puffs };
}

function waterTank(f: Frame, p: Palette, u: number, v: number, lift = 0, over = 0): Shape[] {
  const b = f.gplane(u, v, f.wallH + lift, over);
  const legs = [
    S(pts(P(b.x - 7, b.y), P(b.x - 5, b.y), P(b.x - 5, b.y - 10), P(b.x - 7, b.y - 10)), p.metalDark, false),
    S(pts(P(b.x + 5, b.y), P(b.x + 7, b.y), P(b.x + 7, b.y - 10), P(b.x + 5, b.y - 10)), p.metalDark, false),
  ];
  const body = propBox(b.x, b.y - 10, 9, 5, 12, C, { left: p.timberDark, right: p.timber, top: mix(p.timber, p.paper, 70) });
  const cap = S(octagon(b.x, b.y - 27, 6, 3), p.metal);
  return [...legs, ...body, cap];
}

function aerial(f: Frame, p: Palette, u: number, v: number, hgt = 20, lift = 0, over = 0): Shape[] {
  const b = f.gplane(u, v, f.wallH + lift, over);
  const sh: Shape[] = [S(pts(P(b.x - 1, b.y), P(b.x + 1, b.y), P(b.x + 1, b.y - hgt), P(b.x - 1, b.y - hgt)), p.ink, false)];
  for (let i = 1; i <= 3; i++) {
    const y = b.y - hgt + i * 5;
    const r = 3 + i * 2;
    sh.push(S(pts(P(b.x - r, y - 1), P(b.x + r, y - 1), P(b.x + r, y + 1), P(b.x - r, y + 1)), p.ink, false));
  }
  return sh;
}

/** Three squares that read as a pigeon at 1×. */
function pigeon(f: Frame, p: Palette, u: number, v: number, flip = false, lift = 0, over = 0): Shape[] {
  const b = f.gplane(u, v, f.wallH + lift, over);
  const d = flip ? -1 : 1;
  return [
    S(pts(P(b.x - 3, b.y - 4), P(b.x + 3, b.y - 4), P(b.x + 3, b.y), P(b.x - 3, b.y)), p.stone, false),
    S(pts(P(b.x + 2 * d, b.y - 7), P(b.x + 5 * d, b.y - 7), P(b.x + 5 * d, b.y - 4), P(b.x + 2 * d, b.y - 4)), p.stone, false),
    S(pts(P(b.x + 4 * d, b.y - 6), P(b.x + 6 * d, b.y - 6), P(b.x + 6 * d, b.y - 5), P(b.x + 4 * d, b.y - 5)), p.accent, false),
  ];
}

/* ── the five artifact types, three genuinely different buildings each ── */

const BUILDINGS = {
  /* doc → library ---------------------------------------------------- */
  "library:1": {
    name: "Reading room", sub: "doc · 2×2 · 2 floors", w: 2, h: 2, floors: 2,
    build(f: Frame) {
      const s = [...walls(f, C), ...hipRoof(f, C, 16, 6)];
      for (let i = 0; i < 3; i++) {
        const u = 0.16 + i * 0.28;
        s.push(...windowLit(f, C, "lit", u, u + 0.16, 12, 33, { interior: true }));
      }
      s.push(...windowLit(f, C, "shade", 0.16, 0.34, 12, 33, {}));
      s.push(...windowLit(f, C, "shade", 0.58, 0.76, 12, 33, {}));
      s.push(...door(f, C, "shade", 0.4, 0.54, 24, { mat: true }));
      s.push(...windowBox(f, C, "lit", 0.16, 0.32, 12));
      s.push(...faceSign(f, C, "shade", 0.36, 0.56, 26, 34, [0.05, 0.08, 0.04]));
      const ch = chimney(f, C, 0.74, 0.4, 20, true, roofY("hip", 16, 0.74, 0.4), 6);
      return { shapes: [...s, ...ch.shapes], smoke: ch.smoke };
    },
  },
  "library:2": {
    name: "The stacks", sub: "doc · 2×2 · 4 floors", w: 2, h: 2, floors: 4,
    build(f: Frame) {
      const s = [...walls(f, C), ...flatRoof(f, C, 10, 4)];
      for (let fl = 0; fl < 4; fl++) {
        const y = 10 + fl * FLOOR_H;
        for (let i = 0; i < 3; i++) {
          const u = 0.14 + i * 0.28;
          s.push(...windowLit(f, C, "lit", u, u + 0.17, y, y + 12, { interior: fl > 0, sill: false }));
        }
        s.push(...windowLit(f, C, "shade", 0.2, 0.4, y, y + 12, { sill: false }));
        s.push(...windowLit(f, C, "shade", 0.58, 0.78, y, y + 12, { sill: false }));
      }
      s.push(...door(f, C, "lit", 0.42, 0.6, 26, { mat: true }));
      /* vertical banner down the shaded face */
      s.push(S(f.DQ(0.11, 0.21, 24, f.wallH - 12), C.accent));
      s.push(S(f.DQ(0.135, 0.185, 32, f.wallH - 20), mix(C.accent, C.ink, 60), false));
      s.push(...waterTank(f, C, 0.7, 0.32, 10, 4));
      s.push(...aerial(f, C, 0.32, 0.7, 22, 10, 4));
      s.push(...pigeon(f, C, 0.5, 0.12, false, 10, 4));
      return { shapes: s };
    },
  },
  "library:3": {
    name: "Cottage archive", sub: "doc · 1×2 · 1 floor", w: 1, h: 2, floors: 1,
    build(f: Frame) {
      const s = [...walls(f, C), ...gableRoof(f, C, 16, 6)];
      s.push(...windowLit(f, C, "lit", 0.08, 0.24, 5, 16, { interior: true }));
      s.push(...windowBox(f, C, "lit", 0.08, 0.24, 5));
      s.push(...windowLit(f, C, "lit", 0.76, 0.92, 5, 16, {}));
      s.push(...door(f, C, "lit", 0.44, 0.6, 17, { mat: true }));
      s.push(...awning(f, C, "lit", 0.4, 0.64, 19, 7, 4));
      /* dormer sitting on the near roof slope */
      const dl = roofY("gable", 16, 0.6, 0.76);
      const d = f.gplane(0.6, 0.76, f.wallH + dl, 6);
      s.push(...propBox(d.x, d.y + 4, 9, 5, 13, C, { left: C.wallShade, right: C.wallLit, top: C.wallMid }));
      s.push(S(pts(P(d.x - 5, d.y - 2), P(d.x + 5, d.y - 2), P(d.x + 5, d.y - 8), P(d.x - 5, d.y - 8)), C.glass));
      s.push(S(pts(P(d.x - 10, d.y - 9), P(d.x, d.y - 5), P(d.x + 10, d.y - 9), P(d.x, d.y - 15)), C.roofLit));
      const ch = chimney(f, C, 0.5, 0.16, 22, true, roofY("gable", 16, 0.5, 0.16), 6);
      return { shapes: [...s, ...ch.shapes], smoke: ch.smoke };
    },
  },

  /* table → warehouse ------------------------------------------------ */
  "warehouse:1": {
    name: "Loading dock", sub: "table · 2×3 · 2 floors", w: 2, h: 3, floors: 2,
    build(f: Frame) {
      const s = [...walls(f, C), ...flatRoof(f, C, 8, 4)];
      /* roll-up door with slats */
      s.push(S(f.LQ(0.12, 0.46, 0, 27), C.trim));
      for (let i = 0; i < 6; i++) s.push(S(f.LQ(0.14, 0.44, 2 + i * 4, 4 + i * 4), i % 2 ? C.metal : C.metalDark, false));
      /* dock platform */
      const a = f.L(0.1, 0), b = f.L(0.48, 0);
      const oo = (pt: Vec, k: number): Vec => P(pt.x + k, pt.y + k * 0.5);
      s.push(S(pts(a, b, oo(b, 12), oo(a, 12)), C.stone));
      s.push(S(pts(oo(a, 12), oo(b, 12), P(oo(b, 12).x, oo(b, 12).y + 4), P(oo(a, 12).x, oo(a, 12).y + 4)), mix(C.stone, C.ink, 72), false));
      /* clerestory band + hazard stripe */
      for (let i = 0; i < 4; i++) {
        const u = 0.56 + i * 0.1;
        s.push(...windowLit(f, C, "lit", u, u + 0.07, 26, 34, { mullion: false, sill: false, interior: true }));
      }
      s.push(S(f.LQ(0.02, 0.98, 34, 37), C.accent, false));
      s.push(S(f.DQ(0.02, 0.98, 34, 37), mix(C.accent, C.ink, 70), false));
      s.push(...windowLit(f, C, "shade", 0.3, 0.7, 14, 26, { mullion: true }));
      s.push(...faceSign(f, C, "lit", 0.62, 0.88, 12, 20, [0.05, 0.04, 0.06]));
      return { shapes: s };
    },
  },
  "warehouse:2": {
    name: "Silo store", sub: "table · 2×2 · 2 floors", w: 2, h: 2, floors: 2,
    build(f: Frame) {
      const s = [...walls(f, C), ...gableRoof(f, C, 14, 5)];
      s.push(S(f.LQ(0.1, 0.4, 0, 24), C.trim));
      s.push(S(f.LQ(0.12, 0.38, 2, 22), C.timberDark, false));
      s.push(S(f.LQ(0.12, 0.38, 11, 13), C.timber, false));
      s.push(...windowLit(f, C, "lit", 0.56, 0.72, 14, 28, { interior: true }));
      s.push(...windowLit(f, C, "shade", 0.5, 0.7, 14, 28, {}));
      /* the silo: a stepped drum with a conical cap */
const c = f.plane(0.95, 0.12);
      const drumH = 44, dr = 14;
      s.push(S(octagon(c.x + 2, c.y + 2, dr + 5, R((dr + 5) * 0.52)), C.shadow, false));
      s.push(S(octagon(c.x, c.y, dr + 4, R((dr + 4) * 0.52)), mix(C.stone, C.ink, 82)));
      s.push(S(pts(P(c.x - dr - 4, c.y - 4), P(c.x + dr + 4, c.y - 4), P(c.x + dr + 4, c.y), P(c.x - dr - 4, c.y)), mix(C.stone, C.ink, 88), false));
      s.push(S(octagon(c.x, c.y - 4, dr + 4, R((dr + 4) * 0.52)), C.stone));
      const silo = cylinder(c.x, c.y - 4, dr, drumH, C, { side: C.metal });
      s.push(...silo.shapes);
      /* hoop bands, each bowing round the drum */
      for (let i = 1; i < 4; i++) s.push(wrap(c.x, c.y - 4, -dr, dr, i * 11, i * 11 + 2, C.metalDark));
      s.push(...cone(c.x, c.y - 4 - drumH, dr + 2, 15, C.accent, mix(C.accent, C.ink, 66)));
      s.push(S(pts(P(c.x - 3, c.y - 4 - drumH - 15), P(c.x + 3, c.y - 4 - drumH - 15), P(c.x + 3, c.y - 4 - drumH - 21), P(c.x - 3, c.y - 4 - drumH - 21)), C.metalDark, false));
      return { shapes: s };
    },
  },
  "warehouse:3": {
    name: "Rack hall", sub: "table · 2×3 · 3 floors", w: 2, h: 3, floors: 3,
    build(f: Frame) {
      const s = [...walls(f, C), ...flatRoof(f, C, 10, 4)];
      /* the shelving read through a full-height glazed bay */
      s.push(S(f.LQ(0.08, 0.52, 4, 52), C.trim));
      s.push(S(f.LQ(0.1, 0.5, 6, 50), C.glassDeep, false));
      for (let r = 0; r < 4; r++) s.push(S(f.LQ(0.1, 0.5, 8 + r * 11, 12 + r * 11), C.glass, false));
      for (let cIdx = 1; cIdx < 4; cIdx++) s.push(S(f.LQ(0.1 + cIdx * 0.1 - 0.006, 0.1 + cIdx * 0.1 + 0.006, 6, 50), C.trim, false));
      /* small punched windows on the rest */
      for (let fl = 0; fl < 3; fl++) {
        const y = 10 + fl * FLOOR_H;
        s.push(...windowLit(f, C, "lit", 0.62, 0.74, y, y + 11, { interior: fl === 1, sill: false }));
        s.push(...windowLit(f, C, "lit", 0.8, 0.92, y, y + 11, { sill: false }));
        s.push(...windowLit(f, C, "shade", 0.14 + fl * 0.02, 0.3 + fl * 0.02, y, y + 11, { sill: false }));
      }
      /* external stair up the shaded face */
/* goods door with a flat canopy on the shaded face */
      s.push(...door(f, C, "shade", 0.6, 0.78, 26, { fill: C.metalDark, stoop: false }));
      s.push(S(f.DQ(0.56, 0.82, 29, 33), C.metalDark, false));
      s.push(S(f.DQ(0.58, 0.8, 33, 35), C.accent, false));
      s.push(...waterTank(f, C, 0.74, 0.36, 10, 4));
      s.push(...aerial(f, C, 0.26, 0.74, 18, 10, 4));
      return { shapes: s };
    },
  },

  /* kiosk → newsstand ------------------------------------------------ */
  "newsstand:1": {
    name: "Corner kiosk", sub: "kiosk · 1×1 · 1 floor", w: 1, h: 1, floors: 1,
    build(f: Frame) {
const s = [...walls(f, C, { band: false }), ...hipRoof(f, C, 11, 4)];
      /* open counter on the lit face, papers stacked on it */
      s.push(S(f.LQ(0.12, 0.88, 3, 12), C.glassDeep));
      s.push(S(f.LQ(0.1, 0.9, 0, 3), C.timberDark, false));
      for (let i = 0; i < 3; i++) {
        const u = 0.2 + i * 0.24;
        s.push(S(f.LQ(u, u + 0.16, 3, 7), i === 1 ? C.accent : C.paper, false));
        s.push(S(f.LQ(u + 0.02, u + 0.14, 4, 5), C.stone, false));
      }
      /* the canopy hangs at the eave, well above the counter top */
      s.push(...awning(f, C, "lit", 0.06, 0.94, 20, 9, 6));
      s.push(...windowLit(f, C, "shade", 0.32, 0.68, 5, 16, { sill: false }));
      s.push(...faceSign(f, C, "shade", 0.14, 0.86, 0, 4, [0.16, 0.22, 0.12]));
      return { shapes: s };
    },
  },
  "newsstand:2": {
    name: "Poster column", sub: "kiosk · 1×1 · pillar", w: 1, h: 1, floors: 1,
    build(f: Frame) {
const c = f.plane(0.5, 0.5);
      const s = [S(octagon(c.x + 2, c.y + 2, 24, 12), C.shadow, false)];
      /* two-step stone plinth, each step a disc over a band */
      const step = (cy: number, r: number, rh: number, fill: string) => {
        s.push(S(octagon(c.x, cy, r, R(r * 0.52)), mix(fill, C.ink, 76)));
        s.push(S(pts(P(c.x - r, cy - rh), P(c.x + r, cy - rh), P(c.x + r, cy), P(c.x - r, cy)), mix(fill, C.ink, 84), false));
        s.push(S(octagon(c.x, cy - rh, r, R(r * 0.52)), fill));
      };
      step(c.y, 23, 5, C.stone);
      step(c.y - 5, 18, 4, mix(C.stone, C.paper, 76));
      const base = c.y - 9, r = 13, h = 46;
      const drum = cylinder(c.x, base, r, h, C, {
        side: mix(C.paper, C.ink, 90), shade: mix(C.paper, C.ink, 72),
        hi: C.paper, top: mix(C.paper, C.ink, 96), foot: mix(C.paper, C.ink, 78),
      });
      s.push(...drum.shapes);
      /* pasted bills, bowing with the curve */
      s.push(wrap(c.x, base, -12, -1, 8, 32, C.accent));
      s.push(wrap(c.x, base, 1, 12, 11, 35, C.signA));
      s.push(wrap(c.x, base, -8, 5, 37, 43, C.bloom));
      s.push(S(pts(P(c.x - r, base - h + 3), P(c.x + r, base - h + 3), P(c.x + r, base - h + 5), P(c.x - r, base - h + 5)), C.accent, false));
      /* conical cap + finial */
      s.push(...cone(c.x, base - h, r + 3, 19, C.roofLit, C.roofShade));
      s.push(S(pts(P(c.x - 1, base - h - 19), P(c.x + 1, base - h - 19), P(c.x + 1, base - h - 26), P(c.x - 1, base - h - 26)), C.ink, false));
      s.push(S(octagon(c.x, base - h - 28, 4, 4), C.accent));
      return { shapes: s };
    },
  },
  "newsstand:3": {
    name: "Paper shack", sub: "kiosk · 1×2 · 1 floor", w: 1, h: 2, floors: 1,
    build(f: Frame) {
      const s = [...walls(f, C, { band: false }), ...gableRoof(f, C, 15, 6)];
      s.push(S(f.LQ(0.08, 0.5, 3, 14), C.glassDeep));
      s.push(S(f.LQ(0.06, 0.52, 0, 3), C.timberDark, false));
      /* magazine rack: six spines standing on the counter */
      for (let i = 0; i < 6; i++) {
        const u = 0.11 + i * 0.065;
        s.push(S(f.LQ(u, u + 0.045, 4, 12), ([C.accent, C.signA, C.bloom, C.glass, C.leaf, C.signA][i] ?? C.accent), false));
      }
      s.push(...awning(f, C, "lit", 0.04, 0.54, 19, 9, 5));
      s.push(...door(f, C, "lit", 0.66, 0.82, 18, { stoop: false }));
      s.push(...faceSign(f, C, "shade", 0.14, 0.86, 6, 15, [0.14, 0.24, 0.1]));
      /* bunting along the eaves */
      for (let i = 0; i < 6; i++) {
        const a = f.L(0.06 + i * 0.16, 22);
        s.push(S(pts(P(a.x, a.y), P(a.x + 6, a.y + 1), P(a.x + 3, a.y + 7)), ([C.accent, C.bloom, C.glass][i % 3] ?? C.accent), false));
      }
      return { shapes: s };
    },
  },

  /* board → noticeboard ---------------------------------------------- */
  "noticeboard:1": {
    name: "Pinboard", sub: "board · 1×1 · posts", w: 1, h: 1, floors: 1,
    build(f: Frame) {
const c = f.plane(0.5, 0.5);
      const pa = panel(c.x, c.y, 23);
      const { at, q, off } = pa;
      const postH = 17, bh = 30;
      const s = [S(octagon(c.x, c.y + 2, 26, 13), C.shadow, false)];
      for (const t of [0.1, 0.9]) {
        const b0 = at(t, 0), b1 = at(t, postH);
        s.push(S(pts(P(b0.x - 3, b0.y), P(b0.x + 3, b0.y + 1), P(b1.x + 3, b1.y + 1), P(b1.x - 3, b1.y)), C.timberDark));
      }
      /* board: end cap first so the face reads as a slab with thickness */
      s.push(S(pts(at(1, postH), at(1, postH + bh), P(at(1, postH + bh).x - off.x, at(1, postH + bh).y - off.y), P(at(1, postH).x - off.x, at(1, postH).y - off.y)), mix(C.timber, C.ink, 66)));
      s.push(S(q(0, 1, postH, postH + bh), C.timber));
      s.push(S(q(0.05, 0.95, postH + 3, postH + bh - 3), mix(C.timber, C.ink, 84)));
      const note = (t0: number, t1: number, y0: number, y1: number, fill: string) => {
        s.push(S(q(t0, t1, y0, y1), fill));
        const m = (t0 + t1) / 2;
        s.push(S(q(m - 0.02, m + 0.02, y1 - 3, y1 - 1), C.ink, false));
      };
      note(0.08, 0.3, postH + 13, postH + 23, C.accent);
      note(0.36, 0.6, postH + 14, postH + 24, C.bloom);
      note(0.08, 0.3, postH + 3, postH + 11, C.glass);
      note(0.68, 0.92, postH + 4, postH + 23, C.signA);
      /* lean-to roof, pitched toward the viewer */
      const rA = at(-0.06, postH + bh), rB = at(1.06, postH + bh);
      s.push(S(pts(rA, rB, P(rB.x + off.x * 0.8, rB.y + off.y * 0.8 + 1), P(rA.x + off.x * 0.8, rA.y + off.y * 0.8 + 1)), C.roofLit));
      s.push(S(pts(rA, rB, P(rB.x, rB.y + 3), P(rA.x, rA.y + 3)), C.roofShade, false));
      return { shapes: s };
    },
  },
  "noticeboard:2": {
    name: "Panel run", sub: "board · 2×1 · fence", w: 2, h: 1, floors: 1,
    build(f: Frame) {
const s = [];
      for (let i = 0; i < 3; i++) {
        const c = f.plane(0.2 + i * 0.3, 0.5);
        const pa = panel(c.x, c.y, 17);
        const { at, q, off } = pa;
        const legH = 11, h = 27 + (i === 1 ? 5 : 0);
        s.push(S(octagon(c.x, c.y + 1, 19, 10), C.shadow, false));
        const b0 = at(0.5, 0), b1 = at(0.5, legH);
        s.push(S(pts(P(b0.x - 4, b0.y), P(b0.x + 4, b0.y), P(b1.x + 4, b1.y), P(b1.x - 4, b1.y)), C.metalDark));
        s.push(S(pts(at(1, legH), at(1, legH + h), P(at(1, legH + h).x - off.x, at(1, legH + h).y - off.y), P(at(1, legH).x - off.x, at(1, legH).y - off.y)), mix(C.timber, C.ink, 62)));
        s.push(S(q(0, 1, legH, legH + h), i === 1 ? C.accent : C.timber));
        s.push(S(q(0.07, 0.93, legH + 3, legH + h - 3), mix(C.paper, C.ink, 92)));
        const cols = [C.bloom, C.glass, C.accent];
        for (let n = 0; n < 3; n++) s.push(S(q(0.12 + n * 0.27, 0.32 + n * 0.27, legH + 6, legH + 16), (cols[(n + i) % 3] ?? C.accent), false));
        s.push(S(q(0.12, 0.88, legH + h - 8, legH + h - 6), C.stone, false));
      }
      return { shapes: s };
    },
  },
  "noticeboard:3": {
    name: "Parish pillar", sub: "board · 1×1 · plinth", w: 1, h: 1, floors: 1,
    build(f: Frame) {
      const c = f.plane(0.5, 0.5);
      const s: Shape[] = [];
      s.push(...propBox(c.x, c.y, 20, 10, 6, C, { left: mix(C.stone, C.ink, 70), right: C.stone, top: mix(C.stone, C.paper, 78) }));
      s.push(...propBox(c.x, c.y - 6, 13, 7, 20, C, { left: mix(C.wallShade, C.ink, 88), right: C.wallLit, top: C.wallMid }));
      const pa = panel(c.x, c.y - 26, 20);
      const { at, q, off } = pa;
      const bh = 26;
      s.push(S(pts(at(1, 0), at(1, bh), P(at(1, bh).x - off.x, at(1, bh).y - off.y), P(at(1, 0).x - off.x, at(1, 0).y - off.y)), mix(C.trim, C.ink, 70)));
      s.push(S(q(0, 1, 0, bh), C.trim));
      s.push(S(q(0.06, 0.94, 3, bh - 3), mix(C.paper, C.ink, 94)));
      s.push(S(q(0.12, 0.44, 7, 20), C.accent, false));
      s.push(S(q(0.54, 0.88, 8, 21), C.bloom, false));
      /* lamp on the crown */
      const lc = at(0.5, bh);
      s.push(S(pts(P(lc.x - 2, lc.y), P(lc.x + 2, lc.y), P(lc.x + 2, lc.y - 5), P(lc.x - 2, lc.y - 5)), C.metalDark, false));
      s.push(S(pts(P(lc.x - 6, lc.y - 5), P(lc.x + 6, lc.y - 5), P(lc.x + 4, lc.y - 11), P(lc.x - 4, lc.y - 11)), C.metal));
      s.push(S(pts(P(lc.x - 4, lc.y - 6), P(lc.x + 4, lc.y - 6), P(lc.x + 3, lc.y - 10), P(lc.x - 3, lc.y - 10)), C.glass, false));
      /* planters at the base */
      for (const dx of [-24, 24]) {
        s.push(...propBox(c.x + dx, c.y + 4, 6, 3, 7, C, { left: mix(C.accent, C.ink, 62), right: C.accent, top: mix(C.accent, C.ink, 80) }));
        s.push(S(octagon(c.x + dx, c.y - 6, 7, 4), C.leaf));
        s.push(S(octagon(c.x + dx - 2, c.y - 10, 5, 3), C.leafDark, false));
      }
      return { shapes: s };
    },
  },

  /* canvas → studio -------------------------------------------------- */
  "studio:1": {
    name: "North light", sub: "canvas · 2×3 · 2 floors", w: 2, h: 3, floors: 2,
    build(f: Frame) {
      const s = [...walls(f, C)];
      /* sawtooth roof: glazed face, then a slope, four times */
      const n = 4, th = 14;
      s.push(S(pts(f.top.top, f.top.right, f.top.bottom, f.top.left), mix(C.roofShade, C.ink, 84), false));
      for (let i = 0; i < n; i++) {
        const c = i / n, d = 1 / n;
        const A = (u: number, v: number, y: number) => f.plane(u, v, f.wallH + y);
        /* the slope climbs away from the viewer, so the glazed face at its
           far edge is the one that points back down at us */
        s.push(S(pts(A(c, 0, 0), A(c, 1, 0), A(c + d, 1, th), A(c + d, 0, th)), i % 2 ? C.roofLit : mix(C.roofLit, C.paper, 92)));
        s.push(S(pts(A(c + d, 0, th), A(c + d, 1, th), A(c + d, 1, 0), A(c + d, 0, 0)), C.glass));
        for (let k = 1; k < 4; k++) s.push(S(pts(A(c + d, k / 4 - 0.02, 1), A(c + d, k / 4 + 0.02, 1), A(c + d, k / 4 + 0.02, th - 1), A(c + d, k / 4 - 0.02, th - 1)), C.trim, false));
      }
      /* one big studio window, mullioned */
      s.push(S(f.LQ(0.1, 0.62, 8, 34), C.trim));
      s.push(S(f.LQ(0.12, 0.6, 10, 32), C.glass, false));
      for (let i = 1; i < 5; i++) s.push(S(f.LQ(0.12 + i * 0.096 - 0.005, 0.12 + i * 0.096 + 0.005, 10, 32), C.trim, false));
      s.push(S(f.LQ(0.12, 0.6, 20, 22), C.trim, false));
      s.push(...door(f, C, "lit", 0.72, 0.86, 24, { mat: true }));
      s.push(...windowLit(f, C, "shade", 0.2, 0.5, 12, 30, { interior: true }));
      s.push(...faceSign(f, C, "lit", 0.66, 0.94, 26, 36, [0.06, 0.09]));
      return { shapes: s };
    },
  },
  "studio:2": {
    name: "Glass atelier", sub: "canvas · 2×2 · 2 floors", w: 2, h: 2, floors: 2,
    build(f: Frame) {
      const s: Shape[] = [];
      /* a glazed shell rather than solid walls: mullions carry the structure */
      s.push(S(pts(f.base.left, f.base.bottom, f.top.bottom, f.top.left), mix(C.glassDeep, C.ink, 86)));
      s.push(S(pts(f.base.bottom, f.base.right, f.top.right, f.top.bottom), C.glassDeep));
      for (let i = 0; i <= 5; i++) {
        s.push(S(f.LQ(i / 5 - 0.008, i / 5 + 0.008, 0, f.wallH), C.trim, false));
        s.push(S(f.DQ(i / 5 - 0.008, i / 5 + 0.008, 0, f.wallH), mix(C.trim, C.ink, 82), false));
      }
      for (const y of [13, 26]) {
        s.push(S(f.LQ(0, 1, y, y + 2), C.trim, false));
        s.push(S(f.DQ(0, 1, y, y + 2), mix(C.trim, C.ink, 82), false));
      }
      /* a lit interior floor plate, read through the glass */
      s.push(S(f.LQ(0.06, 0.94, 15, 24), mix(C.glass, C.paper, 60), false));
      s.push(S(f.LQ(0.2, 0.34, 16, 23), C.glassBar, false));
      s.push(S(f.LQ(0.56, 0.76, 17, 23), C.glassBar, false));
      s.push(...flatRoof(f, C, 7, 4));
      /* a lantern skylight on the deck */
      const c = f.gplane(0.5, 0.5, f.wallH + 7, 4);
      s.push(...propBox(c.x, c.y, 16, 8, 10, C, { left: mix(C.glass, C.ink, 74), right: C.glass, top: mix(C.glass, C.paper, 66) }));
      s.push(...door(f, C, "lit", 0.42, 0.6, 24, { fill: C.accent, mat: true }));
      s.push(...faceSign(f, C, "lit", 0.24, 0.72, 30, 38, [0.1, 0.14, 0.07]));
      return { shapes: s };
    },
  },
  "studio:3": {
    name: "Barn studio", sub: "canvas · 2×2 · 2 floors", w: 2, h: 2, floors: 2,
    build(f: Frame) {
      const s = [...walls(f, C, { lit: mix(C.roofLit, C.accent, 78), shade: mix(C.roofLit, C.ink, 62) }), ...gableRoof(f, C, 22, 7)];
      /* sliding doors with a cross brace */
      s.push(S(f.LQ(0.16, 0.78, 0, 30), C.trim));
      s.push(S(f.LQ(0.18, 0.46, 2, 28), C.timberDark, false));
      s.push(S(f.LQ(0.48, 0.76, 2, 28), C.timberDark, false));
      for (const [a, b2] of [[0.18, 0.46], [0.48, 0.76]] as const) {
        s.push(S(f.LQ(a, b2, 12, 16), C.paper, false));
        s.push(S(f.LQ(a + 0.005, a + 0.035, 2, 28), C.paper, false));
        s.push(S(f.LQ(b2 - 0.035, b2 - 0.005, 2, 28), C.paper, false));
      }
      s.push(S(f.LQ(0.16, 0.78, 29, 34), C.metalDark, false));
      s.push(S(f.LQ(0.46, 0.48, 2, 28), C.metal, false));
      /* hayloft door up in the gable */
      /* the gable end is the triangle [e.right, e.bottom, ridge] — sit the
         hayloft door inside it rather than guessing at a plane coordinate */
      const eR = f.gplane(1, 0, f.wallH, 7), eB = f.gplane(1, 1, f.wallH, 7);
      const m2 = P((eR.x + eB.x) / 2, (eR.y + eB.y) / 2 - 22);
      const g = P((eR.x + eB.x + m2.x * 2) / 4, (eR.y + eB.y + m2.y * 2) / 4 + 9);
      s.push(S(pts(P(g.x - 5, g.y), P(g.x + 5, g.y), P(g.x + 5, g.y - 10), P(g.x - 5, g.y - 10)), C.trim));
      s.push(S(pts(P(g.x - 3, g.y - 2), P(g.x + 3, g.y - 2), P(g.x + 3, g.y - 8), P(g.x - 3, g.y - 8)), C.glass, false));
      s.push(...windowLit(f, C, "shade", 0.24, 0.42, 12, 26, { interior: true }));
      s.push(...windowLit(f, C, "shade", 0.6, 0.78, 12, 26, {}));
      /* cupola on the ridge */
      const c = f.gplane(0.3, 0.74, f.wallH + roofY("gable", 22, 0.3, 0.74), 7);
      s.push(...propBox(c.x, c.y + 2, 8, 4, 11, C, { left: C.wallShade, right: C.wallLit, top: C.wallMid }));
      s.push(S(pts(P(c.x - 10, c.y - 8), P(c.x, c.y - 4), P(c.x + 10, c.y - 8), P(c.x, c.y - 17)), C.accent));
      const ch = chimney(f, C, 0.76, 0.74, 16, true, roofY("gable", 22, 0.76, 0.74), 7);
      return { shapes: [...s, ...ch.shapes], smoke: ch.smoke };
    },
  },

  /* the construction stand-in --------------------------------------- */
  "hoarding:1": {
    name: "Hoarding", sub: "any · 2×2 · site", w: 2, h: 2, floors: 1,
    build(f: Frame) {
      const s: Shape[] = [];
      /* excavated ground */
      s.push(S(pts(f.base.top, f.base.right, f.base.bottom, f.base.left), mix(C.timber, C.ink, 74)));
      /* fence panels on both visible sides */
      for (let i = 0; i < 6; i++) {
        const u = i / 6;
        s.push(S(f.LQ(u, u + 1 / 6 - 0.01, 0, 24), i % 2 ? C.accent : C.paper));
        s.push(S(f.DQ(u, u + 1 / 6 - 0.01, 0, 22), i % 2 ? mix(C.paper, C.ink, 84) : mix(C.accent, C.ink, 78)));
      }
      s.push(S(f.LQ(0, 1, 24, 27), C.ink, false));
      s.push(S(f.DQ(0, 1, 22, 25), C.ink, false));
      /* scaffold poles + a plank */
      for (const u of [0.2, 0.8]) {
        const a = f.L(u, 0);
        s.push(S(pts(P(a.x - 2, a.y), P(a.x + 2, a.y), P(a.x + 2, a.y - 36), P(a.x - 2, a.y - 36)), C.metal, false));
      }
      const l = f.L(0.2, 28), r = f.L(0.8, 28);
      s.push(S(pts(l, r, P(r.x, r.y + 4), P(l.x, l.y + 4)), C.timber, false));
      s.push(...faceSign(f, C, "lit", 0.2, 0.8, 6, 18, [0.1, 0.14, 0.08]));
      return { shapes: s };
    },
  },
} satisfies Record<string, Recipe>;



/* ── ground tiles ────────────────────────────────────────────────────── */

const TILE = { top: P(0, 0), right: P(HW, HH), bottom: P(0, TILE_H), left: P(-HW, HH) };
const tileDiamond = pts(TILE.top, TILE.right, TILE.bottom, TILE.left);
/** a point inside the tile, u along +x, v along +y (0..1) */
const tp = (u: number, v: number, y = 0): Vec => P((u - v) * HW, (u + v) * HH - y);

export const TERRAINS = {
  grass: {
    name: "Grass", note: "default ground",
    build() {
      const s = [S(tileDiamond, C.groundLit)];
      s.push(S(pts(tp(0.5, 0), tp(1, 0.5), tp(0.5, 1), tp(0, 0.5)), C.groundMid, false));
      for (const [u, v] of [[0.28, 0.62], [0.66, 0.3], [0.5, 0.84]] as const) {
        const a = tp(u, v);
        s.push(S(pts(P(a.x - 1, a.y), P(a.x + 1, a.y), P(a.x + 1, a.y - 4), P(a.x - 1, a.y - 4)), C.leafDark, false));
        s.push(S(pts(P(a.x + 2, a.y), P(a.x + 4, a.y), P(a.x + 4, a.y - 3), P(a.x + 2, a.y - 3)), C.leafDark, false));
      }
      return s;
    },
  },
  cobble: {
    name: "Cobble", note: "paved district ground",
    build() {
      const s = [S(tileDiamond, C.groundShade)];
      for (let i = 0; i < 2; i++)
        for (let j = 0; j < 2; j++) {
          const c = tp(0.25 + i * 0.5, 0.25 + j * 0.5);
          s.push(S(pts(P(c.x, c.y - 7), P(c.x + 14, c.y), P(c.x, c.y + 7), P(c.x - 14, c.y)), (i + j) % 2 ? C.groundLit : C.groundMid, false));
        }
      return s;
    },
  },
  water: {
    name: "Water", note: "river & harbour",
    build() {
      const s = [S(tileDiamond, C.water)];
      s.push(S(pts(tp(0.15, 0.35), tp(0.5, 0.35), tp(0.5, 0.44), tp(0.15, 0.44)), C.waterLit, false));
      s.push(S(pts(tp(0.55, 0.7), tp(0.85, 0.7), tp(0.85, 0.78), tp(0.55, 0.78)), C.waterLit, false));
      return s;
    },
    shimmer() {
      return [
        S(pts(tp(0.3, 0.12), tp(0.72, 0.12), tp(0.72, 0.2), tp(0.3, 0.2)), C.waterLit, false, { opacity: 0.8 }),
        S(pts(tp(0.1, 0.82), tp(0.44, 0.82), tp(0.44, 0.9), tp(0.1, 0.9)), C.waterLit, false, { opacity: 0.6 }),
      ];
    },
  },
  park: {
    name: "Park", note: "planted ground",
    build() {
      const s = [S(tileDiamond, C.groundAlt)];
      s.push(S(pts(tp(0.5, 0), tp(1, 0.5), tp(0.5, 1), tp(0, 0.5)), mix(C.groundAlt, C.leaf, 60), false));
      const dots: [number, number, keyof Palette][] = [[0.3, 0.3, "bloom"], [0.7, 0.42, "accent"], [0.42, 0.72, "signA"], [0.66, 0.76, "bloom"]];
      for (const [u, v, c] of dots) {
        const a = tp(u, v);
        s.push(S(pts(P(a.x - 2, a.y - 2), P(a.x + 2, a.y - 2), P(a.x + 2, a.y + 2), P(a.x - 2, a.y + 2)), C[c], false));
      }
      return s;
    },
  },
  flowers: {
    name: "Flowers", note: "planted beds",
    build() {
      const s = [S(tileDiamond, C.groundAlt)];
      s.push(S(pts(tp(0.5, 0), tp(1, 0.5), tp(0.5, 1), tp(0, 0.5)), mix(C.groundAlt, C.leafDark, 74), false));
      /* four beds, planted in rows along the +x axis */
      const rows: [number, keyof Palette][] = [[0.22, "bloom"], [0.42, "accent"], [0.62, "signA"], [0.82, "bloom"]];
      for (const [v, col] of rows) {
        const a = tp(0.08, v), b = tp(0.92, v);
        s.push(S(pts(P(a.x, a.y + 1), P(b.x, b.y + 1), P(b.x, b.y - 2), P(a.x, a.y - 2)), C.leafDark, false));
        for (let i = 0; i < 4; i++) {
          const q = tp(0.14 + i * 0.24, v);
          s.push(S(pts(P(q.x - 1, q.y), P(q.x + 1, q.y), P(q.x + 1, q.y - 4), P(q.x - 1, q.y - 4)), C.leaf, false));
          s.push(S(pts(P(q.x - 2, q.y - 4), P(q.x + 2, q.y - 4), P(q.x + 2, q.y - 8), P(q.x - 2, q.y - 8)), C[col], false));
          s.push(S(pts(P(q.x - 1, q.y - 5), P(q.x + 1, q.y - 5), P(q.x + 1, q.y - 7), P(q.x - 1, q.y - 7)), mix(C[col], C.paper, 40), false));
        }
      }
      return s;
    },
  },
  road: {
    name: "Dirt", note: "unpaved route",
    build() {
      const s = [S(tileDiamond, C.timber)];
      for (const [u, v] of [[0.3, 0.4], [0.62, 0.28], [0.48, 0.7], [0.78, 0.62]] as const) {
        const a = tp(u, v);
        s.push(S(pts(P(a.x - 2, a.y), P(a.x, a.y - 1), P(a.x + 2, a.y), P(a.x, a.y + 1)), C.timberDark, false));
      }
      return s;
    },
  },
  plaza: {
    name: "Plaza", note: "district floor",
    build() {
      const s = [S(tileDiamond, mix(C.paper, C.groundShade, 55))];
      for (let i = 0; i < 2; i++)
        for (let j = 0; j < 2; j++) {
          const c = tp(0.25 + i * 0.5, 0.25 + j * 0.5);
          if ((i + j) % 2) continue;
          s.push(S(pts(P(c.x, c.y - 7), P(c.x + 14, c.y), P(c.x, c.y + 7), P(c.x - 14, c.y)), C.groundShade, false));
        }
      s.push(S(pts(tp(0.46, 0.46), tp(0.54, 0.46), tp(0.54, 0.54), tp(0.46, 0.54)), C.accent, false));
      return s;
    },
  },
} satisfies Record<string, { name: string; note: string; build: () => Shape[]; shimmer?: () => Shape[] }>;

/* ── street props ────────────────────────────────────────────────────── */

const PROPS = {
  lamp: {
    name: "Street lamp", sub: "lights at dusk",
    build() {
      const c = tp(0.5, 0.5);
      const s = [...propBox(c.x, c.y, 7, 4, 4, C, { left: mix(C.stone, C.ink, 70), right: C.stone, top: mix(C.stone, C.paper, 80) })];
      s.push(S(pts(P(c.x - 2, c.y - 4), P(c.x + 2, c.y - 4), P(c.x + 2, c.y - 40), P(c.x - 2, c.y - 40)), C.metalDark, false));
      s.push(S(pts(P(c.x - 2, c.y - 40), P(c.x + 10, c.y - 40), P(c.x + 10, c.y - 43), P(c.x - 2, c.y - 43)), C.metalDark, false));
      s.push(S(pts(P(c.x + 5, c.y - 43), P(c.x + 13, c.y - 43), P(c.x + 11, c.y - 51), P(c.x + 7, c.y - 51)), C.metal));
      s.push(S(pts(P(c.x + 6, c.y - 44), P(c.x + 12, c.y - 44), P(c.x + 10.5, c.y - 49), P(c.x + 7.5, c.y - 49)), C.glass, false));
      return s;
    },
  },
  tree: {
    name: "Tree", sub: "two canopy tiers",
    build() {
      const c = tp(0.5, 0.5);
      const s = [S(octagon(c.x + 2, c.y + 1, 13, 6), C.shadow, false)];
      s.push(S(pts(P(c.x - 3, c.y), P(c.x + 3, c.y), P(c.x + 2, c.y - 20), P(c.x - 2, c.y - 20)), C.timberDark));
      s.push(S(octagon(c.x, c.y - 26, 17, 11), C.leafDark));
      s.push(S(octagon(c.x + 3, c.y - 30, 13, 8), C.leaf));
      s.push(S(octagon(c.x + 5, c.y - 33, 7, 4), mix(C.leaf, C.paper, 74), false));
      return s;
    },
  },
  bench: {
    name: "Bench", sub: "seat + back",
    build() {
const c = tp(0.5, 0.5);
      const s = [S(pts(P(c.x - 18, c.y + 1), P(c.x + 14, c.y + 9), P(c.x + 8, c.y + 12), P(c.x - 24, c.y + 4)), C.shadow, false)];
      const A = P(c.x - 16, c.y - 4), B = P(c.x + 16, c.y + 4);
      const seatY = 11, fx = -7, fy = 4;
      for (const t of [0.16, 0.84]) {
        const lx = A.x + (B.x - A.x) * t, ly = A.y + (B.y - A.y) * t;
        s.push(...propBox(lx + fx / 2, ly + fy / 2, 5, 3, seatY, C, { left: mix(C.metalDark, C.ink, 82), right: C.metalDark, top: C.metalDark }));
      }
      /* seat: top face, then its 3px front edge */
      s.push(S(pts(P(A.x, A.y - seatY), P(B.x, B.y - seatY), P(B.x + fx, B.y + fy - seatY), P(A.x + fx, A.y + fy - seatY)), C.timber));
      s.push(S(pts(P(A.x + fx, A.y + fy - seatY), P(B.x + fx, B.y + fy - seatY), P(B.x + fx, B.y + fy - seatY + 4), P(A.x + fx, A.y + fy - seatY + 4)), C.timberDark));
      s.push(S(pts(P(A.x + fx + 2, A.y + fy - seatY + 1), P(B.x + fx - 2, B.y + fy - seatY + 1), P(B.x + fx - 2, B.y + fy - seatY + 2), P(A.x + fx + 2, A.y + fy - seatY + 2)), mix(C.timber, C.paper, 70), false));
      /* backrest, standing on the far edge */
      s.push(S(pts(P(A.x, A.y - seatY), P(B.x, B.y - seatY), P(B.x, B.y - seatY - 13), P(A.x, A.y - seatY - 13)), C.timber));
      s.push(S(pts(P(A.x, A.y - seatY - 5), P(B.x, B.y - seatY - 5), P(B.x, B.y - seatY - 7), P(A.x, A.y - seatY - 7)), C.timberDark, false));
      s.push(S(pts(P(A.x, A.y - seatY - 13), P(B.x, B.y - seatY - 13), P(B.x - 3, B.y - seatY - 15), P(A.x - 3, A.y - seatY - 15)), mix(C.timber, C.paper, 72)));
      return s;
    },
  },
  crates: {
    name: "Crates", sub: "stacked stock",
    build() {
      const c = tp(0.5, 0.55);
      const s = [...propBox(c.x - 6, c.y, 10, 5, 12, C)];
      s.push(S(pts(P(c.x - 6, c.y + 5 - 12), P(c.x + 4, c.y - 12), P(c.x + 4, c.y - 10), P(c.x - 6, c.y + 5 - 10)), C.timberDark, false));
      s.push(...propBox(c.x + 8, c.y - 2, 8, 4, 10, C, { right: mix(C.timber, C.paper, 80) }));
      s.push(...propBox(c.x - 3, c.y - 12, 8, 4, 9, C, { right: C.accent, top: mix(C.accent, C.paper, 70), left: mix(C.accent, C.ink, 70) }));
      return s;
    },
  },
  sign: {
    name: "Signpost", sub: "wayfinding",
    build() {
      const c = tp(0.5, 0.5);
      const s = [S(octagon(c.x, c.y + 1, 9, 5), C.shadow, false)];
      s.push(S(pts(P(c.x - 7, c.y + 1), P(c.x + 7, c.y + 1), P(c.x + 7, c.y - 3), P(c.x - 7, c.y - 3)), C.stone));
      s.push(S(pts(P(c.x - 2, c.y - 2), P(c.x + 2, c.y - 2), P(c.x + 2, c.y - 36), P(c.x - 2, c.y - 36)), C.timberDark));
      /* each plate is a panel on the +x axis, hung off one side of the post */
      const plate = (y: number, t0: number, t1: number, words: number[]) => {
        const pa = panel(c.x, c.y - y, 15);
        const { at, q, off } = pa;
        s.push(S(pts(at(t1, 0), at(t1, 10), P(at(t1, 10).x - off.x, at(t1, 10).y - off.y), P(at(t1, 0).x - off.x, at(t1, 0).y - off.y)), mix(C.signA, C.ink, 62)));
        s.push(S(q(t0, t1, 0, 10), C.signA));
        const span = t1 - t0;
        let u = t0 + span * 0.1;
        for (const w of words) {
          if (u + span * w > t1 - span * 0.08) break;
          s.push(S(q(u, u + span * w, 4, 6), C.signB, false));
          u += span * (w + 0.1);
        }
        /* bracket back to the post */
        const b0 = at((t0 + t1) / 2, 0);
        s.push(S(pts(P(b0.x - 2, b0.y), P(b0.x + 2, b0.y + 1), P(c.x + 2, c.y - y + 4), P(c.x - 2, c.y - y + 3)), C.metalDark, false));
      };
      plate(34, 0.02, 0.5, [0.3, 0.34]);
      plate(20, 0.5, 0.98, [0.38, 0.22]);
      return s;
    },
  },
  planter: {
    name: "Planter", sub: "district trim",
    build() {
      const c = tp(0.5, 0.5);
      const s = [...propBox(c.x, c.y, 12, 6, 9, C, { left: mix(C.stone, C.ink, 72), right: C.stone, top: mix(C.timberDark, C.ink, 86) })];
      s.push(S(octagon(c.x - 3, c.y - 13, 8, 5), C.leafDark));
      s.push(S(octagon(c.x + 4, c.y - 15, 7, 4), C.leaf));
      s.push(S(pts(P(c.x + 2, c.y - 20), P(c.x + 5, c.y - 20), P(c.x + 5, c.y - 17), P(c.x + 2, c.y - 17)), C.bloom, false));
      return s;
    },
  },
  hydrantpost: {
    name: "Bollards", sub: "kerb edge",
    build() {
      const s: Shape[] = [];
      for (const [u, v] of [[0.2, 0.5], [0.8, 0.5]] as const) {
        const c = tp(u, v);
        s.push(S(octagon(c.x, c.y + 1, 8, 4), C.shadow, false));
        s.push(...propBox(c.x, c.y, 6, 3, 9, C, { left: mix(C.accent, C.ink, 62), right: C.accent, top: mix(C.accent, C.paper, 72) }));
        s.push(S(pts(P(c.x - 6, c.y - 5), P(c.x + 6, c.y - 5), P(c.x + 6, c.y - 7), P(c.x - 6, c.y - 7)), C.ink, false));
      }
      return s;
    },
  },
  fountain: {
    name: "Fountain", sub: "plaza centrepiece",
    build() {
      const c = tp(0.5, 0.5);
      const s = [S(octagon(c.x, c.y, 26, 14), mix(C.stone, C.paper, 60))];
      s.push(S(octagon(c.x, c.y, 20, 11), C.water));
      s.push(S(octagon(c.x + 3, c.y - 1, 12, 6), C.waterLit, false));
      s.push(...propBox(c.x, c.y, 5, 3, 12, C, { left: mix(C.stone, C.ink, 72), right: C.stone, top: mix(C.stone, C.paper, 80) }));
      s.push(S(octagon(c.x, c.y - 13, 11, 5), mix(C.stone, C.paper, 70)));
      s.push(S(pts(P(c.x - 1, c.y - 15), P(c.x + 1, c.y - 15), P(c.x + 1, c.y - 22), P(c.x - 1, c.y - 22)), C.waterLit, false));
      return s;
    },
  },
} satisfies Record<string, { name: string; sub: string; build: () => Shape[] }>;

/* ── assembly ────────────────────────────────────────────────────────── */

/**
 * Bounds are measured rather than derived, because a chimney, an aerial or a
 * silo legitimately sticks out above the formula's idea of the height.
 */
function bounds(shapes: Shape[], pad = 3) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const s of shapes) {
    for (const pair of s.points.split(" ")) {
      const comma = pair.indexOf(",");
      if (comma < 0) continue;
      const x = Number(pair.slice(0, comma));
      const y = Number(pair.slice(comma + 1));
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  return { minX: minX - pad, minY: minY - pad, maxX: maxX + pad, maxY: maxY + pad };
}

function assemble(shapes: Shape[], smoke: Shape[]): SpriteGeometry {
  const b = bounds([...shapes, ...smoke]);
  const width = b.maxX - b.minX;
  const height = b.maxY - b.minY;
  return {
    viewBox: `${b.minX} ${b.minY} ${width} ${height}`,
    width,
    height,
    originX: -b.minX,
    originY: -b.minY,
    shapes,
    smoke,
  };
}

/** Which recipe a (key, variant) pair draws. */
type BuildingId = keyof typeof BUILDINGS;

/**
 * Every (key, variant) pair has a recipe -- hoarding is the one key with a
 * single variant -- but `sprite_variant` arrives from the database, so an
 * unexpected value falls back to the first variant rather than crashing.
 */
function recipeFor(key: SpriteKey, variant: SpriteVariant): Recipe {
  const id = (key === "hoarding" ? "hoarding:1" : `${key}:${variant}`) as BuildingId;
  return BUILDINGS[id] ?? BUILDINGS[`${key}:1` as BuildingId] ?? BUILDINGS["library:1"];
}

/**
 * The footprint each recipe is drawn for. The lit (lower-right) face spans the
 * H axis, so an elongated building wants its long side on H or its facade
 * lands on the short end. Placement and the database must agree with this.
 */
export function spriteFootprint(key: SpriteKey, variant: SpriteVariant) {
  const def = recipeFor(key, variant);
  return { w: def.w, h: def.h, floors: def.floors };
}

/**
 * Build the geometry for one building.
 *
 * `state` only affects colour, offset and a few extra shapes, so callers may
 * cache on (key, variant, footprint, floors) and re-run states cheaply.
 */
export function buildingSprite(
  key: SpriteKey,
  variant: SpriteVariant,
  footprintW: number,
  footprintH: number,
  floors: number,
  state: SpriteState = "idle",
): SpriteGeometry {
  const def = recipeFor(key, variant);
  const f = frame(footprintW || def.w, footprintH || def.h, floors || def.floors);
  const built = def.build(f);
  let shapes: Shape[] = [...castShadow(f, C), ...built.shapes];
  const smoke = built.smoke ?? [];

  if (state === "ghost") {
    shapes = shapes.map((s) => ({ ...s, opacity: 0.42 }));
    const d = f.base;
    shapes.push(S(pts(d.top, d.right, d.bottom, d.left), "none", true, { dash: "4 3" }));
    return assemble(shapes, []);
  }

  if (state === "boarded") {
    shapes = shapes.map((s) => ({ ...s, fill: s.fill === "none" ? "none" : mix(s.fill, "var(--color-ash)", 60) }));
    for (const u of [0.18, 0.5]) {
      shapes.push(S(f.LQ(u, u + 0.34, 8, 13), C.timber));
      shapes.push(S(f.LQ(u + 0.02, u + 0.36, 20, 25), C.timber));
    }
    shapes.push(S(f.DQ(0.3, 0.7, 12, 17), C.timber));
  }

  if (state === "hover") {
    const lift = (s: Shape): Shape => ({
      ...s,
      points: s.points
        .split(" ")
        .map((q) => {
          const comma = q.indexOf(",");
          if (comma < 0) return q;
          return `${q.slice(0, comma)},${Number(q.slice(comma + 1)) - 3}`;
        })
        .join(" "),
    });
    shapes = shapes.map(lift);
    const d = f.base;
    shapes.unshift(S(pts(d.top, d.right, d.bottom, d.left), "none", true));
  }

  return assemble(shapes, smoke);
}

/* ── ground, roads, props ────────────────────────────────────────────── */

export type Terrain = Database["public"]["Enums"]["terrain"];

/** Flat fills, kept for anything that only needs one colour per tile. */
export const TERRAIN_FILL: Record<Terrain, string> = {
  grass: C.groundLit,
  cobble: C.groundShade,
  water: C.water,
  park: C.groundAlt,
  road: C.timber,
};

/** The tile diamond, in a 64x32 box with its top vertex at (32, 0). */
export const TILE_DIAMOND = `${HW},0 ${TILE_W},${HH} ${HW},${TILE_H} 0,${HH}`;

export type TerrainKey = keyof typeof TERRAINS;
type TerrainRecipe = { name: string; note: string; build: () => Shape[]; shimmer?: () => Shape[] };

/**
 * A ground tile. `skirt` adds the earth edge that makes a district read as a
 * plateau -- pass it on the tiles at a neighbourhood's far boundary.
 */
export function terrainSprite(key: TerrainKey, skirt = false): SpriteGeometry {
  const shapes: Shape[] = [];
  if (skirt) {
    const d = 7;
    shapes.push(
      S(pts(TILE.left, TILE.bottom, P(TILE.bottom.x, TILE.bottom.y + d), P(TILE.left.x, TILE.left.y + d)), mix(C.edge, C.ink, 78)),
      S(pts(TILE.bottom, TILE.right, P(TILE.right.x, TILE.right.y + d), P(TILE.bottom.x, TILE.bottom.y + d)), C.edge),
    );
  }
  const terrain: TerrainRecipe = TERRAINS[key];
  shapes.push(...terrain.build());
  /* water's shimmer frames ride in the smoke slot: one group the caller can
     animate with stepped easing and stop under prefers-reduced-motion */
  return assemble(shapes, terrain.shimmer?.() ?? []);
}

export type RoadTier = "dirt" | "paved" | "avenue";
export type RoadArm = "n" | "e" | "s" | "w";

/**
 * One tile of road. Pass the arms a solved route actually connects -- the
 * caller derives them from the neighbouring path tiles, so the same function
 * draws straights, corners, tees, crossroads and termini.
 */
export function roadSprite(arms: RoadArm[], tier: RoadTier = "paved"): SpriteGeometry {
  const hwid = tier === "avenue" ? 0.34 : tier === "paved" ? 0.26 : 0.2;
  const surface = tier === "dirt" ? C.timber : tier === "avenue" ? mix(C.stone, C.paper, 45) : C.stone;
  const kerb = tier === "dirt" ? C.timberDark : mix(surface, C.ink, 72);
  const c = 0.5;
  const quad = (u0: number, u1: number, v0: number, v1: number, fill: string, stroke?: boolean) =>
    S(pts(tp(u0, v0), tp(u1, v0), tp(u1, v1), tp(u0, v1)), fill, stroke);

  const shapes: Shape[] = [S(tileDiamond, C.groundLit), quad(c - hwid, c + hwid, c - hwid, c + hwid, surface, false)];
  const arm: Record<RoadArm, [number, number, number, number]> = {
    e: [c + hwid, 1, c - hwid, c + hwid],
    w: [0, c - hwid, c - hwid, c + hwid],
    s: [c - hwid, c + hwid, c + hwid, 1],
    n: [c - hwid, c + hwid, 0, c - hwid],
  };
  for (const a of arms) shapes.push(quad(...arm[a], surface, false));
  for (const a of arms) {
    const [u0, u1, v0, v1] = arm[a];
    if (a === "e" || a === "w") {
      shapes.push(quad(u0, u1, v1 - 0.03, v1, kerb, false), quad(u0, u1, v0, v0 + 0.03, kerb, false));
    } else {
      shapes.push(quad(u1 - 0.03, u1, v0, v1, kerb, false), quad(u0, u0 + 0.03, v0, v1, kerb, false));
    }
  }
  if (tier !== "dirt") {
    const dash = tier === "avenue" ? C.accent : mix(surface, C.paper, 45);
    for (const a of arms) {
      if (a === "e") shapes.push(quad(c + 0.16, c + 0.34, c - 0.025, c + 0.025, dash, false));
      if (a === "w") shapes.push(quad(c - 0.34, c - 0.16, c - 0.025, c + 0.025, dash, false));
      if (a === "s") shapes.push(quad(c - 0.025, c + 0.025, c + 0.16, c + 0.34, dash, false));
      if (a === "n") shapes.push(quad(c - 0.025, c + 0.025, c - 0.34, c - 0.16, dash, false));
    }
  }
  if (arms.length === 1) shapes.push(quad(c - hwid, c + hwid, c - hwid - 0.03, c - hwid, kerb, false));
  return assemble(shapes, []);
}

export type PropKey = keyof typeof PROPS;
export const PROP_ORDER = Object.keys(PROPS) as PropKey[];

/** Street furniture. Props stand on their own tile and never leave it. */
export function propSprite(key: PropKey): SpriteGeometry {
  return assemble(PROPS[key].build(), []);
}
