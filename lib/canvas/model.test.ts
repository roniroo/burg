import { describe, expect, it } from "vitest";
import {
  GRID,
  boundsOf,
  createNode,
  hitTest,
  moveNode,
  parseNode,
  parseScene,
  snapToGrid,
  type Scene,
  type SceneNode,
} from "./model";

const node = (over: Partial<SceneNode> & Pick<SceneNode, "id" | "kind">): SceneNode => ({
  x: 0,
  y: 0,
  w: 100,
  h: 50,
  color: 1,
  ...over,
});

describe("snapToGrid", () => {
  it("lands everything on the 8px grid", () => {
    expect(snapToGrid(0)).toBe(0);
    expect(snapToGrid(3)).toBe(0);
    expect(snapToGrid(5)).toBe(8);
    expect(snapToGrid(-3)).toBe(-0);
    expect(snapToGrid(-5)).toBe(-8);
    expect(snapToGrid(101) % GRID).toBe(0);
  });
});

describe("parseNode", () => {
  it("accepts a well-formed node", () => {
    const parsed = parseNode({ id: "a", kind: "rect", x: 8, y: 16, w: 32, h: 32, color: 3 });
    expect(parsed).toMatchObject({ id: "a", kind: "rect", x: 8, color: 3 });
  });

  it("rejects nodes with no id or an unknown kind", () => {
    expect(parseNode({ kind: "rect", x: 0, y: 0 })).toBeNull();
    expect(parseNode({ id: "a", kind: "portal", x: 0, y: 0 })).toBeNull();
  });

  it("rejects nodes with non-finite coordinates", () => {
    expect(parseNode({ id: "a", kind: "rect", x: Number.NaN, y: 0 })).toBeNull();
    expect(parseNode({ id: "a", kind: "rect", x: 0, y: Number.POSITIVE_INFINITY })).toBeNull();
  });

  it("clamps colour into the palette", () => {
    expect(parseNode({ id: "a", kind: "rect", x: 0, y: 0, color: 99 })?.color).toBe(6);
    expect(parseNode({ id: "a", kind: "rect", x: 0, y: 0, color: -4 })?.color).toBe(1);
  });

  it("keeps only well-formed pen points", () => {
    const parsed = parseNode({
      id: "a",
      kind: "pen",
      x: 0,
      y: 0,
      points: [{ x: 1, y: 2 }, { x: "nope" }, null, { x: 3, y: 4 }],
    });
    expect(parsed?.points).toEqual([{ x: 1, y: 2 }, { x: 3, y: 4 }]);
  });
});

describe("parseScene", () => {
  it("returns an empty scene for junk", () => {
    expect(parseScene(null).nodes).toEqual([]);
    expect(parseScene("nope").nodes).toEqual([]);
    expect(parseScene({}).nodes).toEqual([]);
  });

  it("drops malformed nodes rather than refusing to open", () => {
    // One bad shape must not cost the user the whole whiteboard.
    const scene = parseScene({
      nodes: [{ id: "good", kind: "rect", x: 0, y: 0 }, { kind: "rect" }, 42],
    });
    expect(scene.nodes).toHaveLength(1);
    expect(scene.nodes[0]?.id).toBe("good");
  });

  it("clamps the stored zoom into range", () => {
    expect(parseScene({ viewport: { x: 0, y: 0, zoom: 99 } }).viewport.zoom).toBe(3);
    expect(parseScene({ viewport: { x: 0, y: 0, zoom: 0.01 } }).viewport.zoom).toBe(0.5);
  });

  it("keeps only edges with both ends named", () => {
    const scene = parseScene({ edges: [{ id: "e", from: "a", to: "b" }, { id: "f", from: "a" }] });
    expect(scene.edges).toHaveLength(1);
  });
});

describe("boundsOf", () => {
  it("normalises a box drawn right-to-left", () => {
    expect(boundsOf(node({ id: "a", kind: "rect", x: 100, y: 100, w: -40, h: -20 }))).toEqual({
      x: 60,
      y: 80,
      w: 40,
      h: 20,
    });
  });

  it("wraps a pen stroke around its points", () => {
    const stroke = node({
      id: "p",
      kind: "pen",
      x: 10,
      y: 10,
      points: [{ x: 0, y: 0 }, { x: 20, y: 5 }, { x: 5, y: 30 }],
    });
    expect(boundsOf(stroke)).toEqual({ x: 10, y: 10, w: 20, h: 30 });
  });
});

describe("hitTest", () => {
  const scene: Scene = {
    nodes: [
      node({ id: "under", kind: "rect", x: 0, y: 0, w: 100, h: 100 }),
      node({ id: "over", kind: "rect", x: 50, y: 50, w: 100, h: 100 }),
    ],
    edges: [],
    viewport: { x: 0, y: 0, zoom: 1 },
  };

  it("returns the topmost node where they overlap", () => {
    expect(hitTest(scene, 60, 60)?.id).toBe("over");
  });

  it("returns the only node where they do not", () => {
    expect(hitTest(scene, 10, 10)?.id).toBe("under");
  });

  it("returns null on empty board", () => {
    expect(hitTest({ nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 } }, 5, 5)).toBeNull();
  });

  it("gives thin things some slack so they can be grabbed", () => {
    const thin: Scene = {
      nodes: [node({ id: "line", kind: "line", x: 0, y: 0, w: 100, h: 0 })],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
    };
    // A few pixels off a zero-height line still selects it.
    expect(hitTest(thin, 50, 4)?.id).toBe("line");
    expect(hitTest(thin, 50, 40)).toBeNull();
  });
});

describe("createNode", () => {
  it("snaps new nodes to the grid", () => {
    const made = createNode("sticky", 13, 27);
    expect(made.x % GRID).toBe(0);
    expect(made.y % GRID).toBe(0);
  });

  it("gives stickies text and pen strokes a first point", () => {
    expect(createNode("sticky", 0, 0).text).toBe("");
    expect(createNode("pen", 0, 0).points).toHaveLength(1);
    expect(createNode("rect", 0, 0).text).toBeUndefined();
  });
});

describe("moveNode", () => {
  it("keeps a moved node on the grid", () => {
    const moved = moveNode(node({ id: "a", kind: "rect", x: 16, y: 16 }), 5, 11);
    expect(moved.x).toBe(24);
    expect(moved.y).toBe(24);
  });
});
