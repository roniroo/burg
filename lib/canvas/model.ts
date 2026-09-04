/**
 * Whiteboard scene model.
 *
 * Deliberately small: five things you can draw, an 8px grid, and no layers.
 * Pure and DOM-free so the geometry can be tested without a canvas.
 *
 * The whole scene is one jsonb blob, so this file is also the schema. Anything
 * it cannot parse is dropped rather than crashing the editor -- a whiteboard
 * that refuses to open because of one bad node would be worse than one missing
 * a shape.
 */

export const GRID = 8;

export type NodeKind = "sticky" | "rect" | "ellipse" | "line" | "pen";

export type SceneNode = {
  id: string;
  kind: NodeKind;
  x: number;
  y: number;
  /** Width and height for boxes; the vector to the far end for lines. */
  w: number;
  h: number;
  /** Sticky text, or a label on a shape. */
  text?: string;
  /** Palette index, 1-6. */
  color: number;
  /** Freehand only: points relative to (x, y). */
  points?: Array<{ x: number; y: number }>;
};

export type Viewport = { x: number; y: number; zoom: number };

export type Scene = {
  nodes: SceneNode[];
  /** Reserved: connectors between nodes, once nodes can be anchored. */
  edges: Array<{ id: string; from: string; to: string }>;
  viewport: Viewport;
};

export const EMPTY_SCENE: Scene = { nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 } };

/** Snap a value to the 8px grid. Everything placed on the board lands on it. */
export function snapToGrid(value: number): number {
  return Math.round(value / GRID) * GRID;
}

export function snapPoint(x: number, y: number): { x: number; y: number } {
  return { x: snapToGrid(x), y: snapToGrid(y) };
}

const KINDS: NodeKind[] = ["sticky", "rect", "ellipse", "line", "pen"];

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/** Coerce one unknown value into a node, or null if it is not one. */
export function parseNode(raw: unknown): SceneNode | null {
  if (!raw || typeof raw !== "object") return null;
  const n = raw as Record<string, unknown>;

  if (typeof n["id"] !== "string" || !n["id"]) return null;
  if (typeof n["kind"] !== "string" || !KINDS.includes(n["kind"] as NodeKind)) return null;
  if (!isFiniteNumber(n["x"]) || !isFiniteNumber(n["y"])) return null;

  const points = Array.isArray(n["points"])
    ? n["points"]
        .filter((p): p is { x: number; y: number } =>
          !!p && typeof p === "object" && isFiniteNumber((p as { x: unknown }).x) && isFiniteNumber((p as { y: unknown }).y),
        )
        .map((p) => ({ x: p.x, y: p.y }))
    : undefined;

  return {
    id: n["id"],
    kind: n["kind"] as NodeKind,
    x: n["x"],
    y: n["y"],
    w: isFiniteNumber(n["w"]) ? n["w"] : 0,
    h: isFiniteNumber(n["h"]) ? n["h"] : 0,
    text: typeof n["text"] === "string" ? n["text"] : undefined,
    color: isFiniteNumber(n["color"]) ? Math.min(6, Math.max(1, Math.round(n["color"]))) : 1,
    ...(points && points.length > 0 ? { points } : {}),
  };
}

/** Read a stored scene, discarding anything malformed. */
export function parseScene(raw: unknown): Scene {
  if (!raw || typeof raw !== "object") return EMPTY_SCENE;
  const s = raw as Record<string, unknown>;

  const nodes = Array.isArray(s["nodes"])
    ? s["nodes"].map(parseNode).filter((n): n is SceneNode => n !== null)
    : [];

  const viewportRaw = (s["viewport"] ?? {}) as Record<string, unknown>;
  const viewport: Viewport = {
    x: isFiniteNumber(viewportRaw["x"]) ? viewportRaw["x"] : 0,
    y: isFiniteNumber(viewportRaw["y"]) ? viewportRaw["y"] : 0,
    zoom: isFiniteNumber(viewportRaw["zoom"]) ? Math.min(3, Math.max(0.5, viewportRaw["zoom"])) : 1,
  };

  const edges = Array.isArray(s["edges"])
    ? s["edges"].flatMap((e) => {
        if (!e || typeof e !== "object") return [];
        const edge = e as Record<string, unknown>;
        if (typeof edge["id"] !== "string" || typeof edge["from"] !== "string" || typeof edge["to"] !== "string") {
          return [];
        }
        return [{ id: edge["id"], from: edge["from"], to: edge["to"] }];
      })
    : [];

  return { nodes, edges, viewport };
}

/** The axis-aligned box a node occupies, normalised for negative sizes. */
export function boundsOf(node: SceneNode): { x: number; y: number; w: number; h: number } {
  if (node.kind === "pen" && node.points && node.points.length > 0) {
    const xs = node.points.map((p) => p.x);
    const ys = node.points.map((p) => p.y);
    const minX = Math.min(...xs);
    const minY = Math.min(...ys);
    return {
      x: node.x + minX,
      y: node.y + minY,
      w: Math.max(...xs) - minX,
      h: Math.max(...ys) - minY,
    };
  }

  return {
    x: Math.min(node.x, node.x + node.w),
    y: Math.min(node.y, node.y + node.h),
    w: Math.abs(node.w),
    h: Math.abs(node.h),
  };
}

/** Topmost node containing a point, or null. Later nodes sit on top. */
export function hitTest(scene: Scene, x: number, y: number): SceneNode | null {
  for (let i = scene.nodes.length - 1; i >= 0; i--) {
    const node = scene.nodes[i]!;
    const b = boundsOf(node);
    // Lines and pen strokes get a little slack, being thin.
    const pad = node.kind === "line" || node.kind === "pen" ? 6 : 0;
    if (x >= b.x - pad && x <= b.x + b.w + pad && y >= b.y - pad && y <= b.y + b.h + pad) {
      return node;
    }
  }
  return null;
}

/** Default size for a newly dropped node of each kind. */
export function defaultSize(kind: NodeKind): { w: number; h: number } {
  switch (kind) {
    case "sticky":
      return { w: 120, h: 96 };
    case "rect":
      return { w: 128, h: 80 };
    case "ellipse":
      return { w: 112, h: 80 };
    case "line":
      return { w: 96, h: 0 };
    case "pen":
      return { w: 0, h: 0 };
  }
}

export function createNode(kind: NodeKind, x: number, y: number, color = 1): SceneNode {
  const size = defaultSize(kind);
  const at = snapPoint(x, y);
  return {
    id: crypto.randomUUID(),
    kind,
    x: at.x,
    y: at.y,
    w: size.w,
    h: size.h,
    color,
    ...(kind === "sticky" ? { text: "" } : {}),
    ...(kind === "pen" ? { points: [{ x: 0, y: 0 }] } : {}),
  };
}

/** Move a node, keeping it on the grid. */
export function moveNode(node: SceneNode, dx: number, dy: number): SceneNode {
  return { ...node, x: snapToGrid(node.x + dx), y: snapToGrid(node.y + dy) };
}
