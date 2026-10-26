import { describe, expect, it } from "vitest";
import {
  hitAreaFromPixels,
  lotTiles,
  parseHitArea,
  pngSize,
  spriteLayout,
  suggestFootprint,
} from "./custom-sprites";
import { tileToScreen } from "./iso";

/** The first 24 bytes of a PNG: signature, then the IHDR length, type, width and height. */
function pngHeader(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(24);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  const view = new DataView(bytes.buffer);
  view.setUint32(8, 13);
  bytes.set([..."IHDR"].map((c) => c.charCodeAt(0)), 12);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return bytes;
}

/** An RGBA buffer with the given pixels opaque. */
function pixels(width: number, height: number, opaque: Array<[number, number]>, alpha = 255): Uint8ClampedArray {
  const data = new Uint8ClampedArray(width * height * 4);
  for (const [x, y] of opaque) data[(y * width + x) * 4 + 3] = alpha;
  return data;
}

const asSet = (points: string | null) => new Set((points ?? "").split(" "));

describe("pngSize", () => {
  it("reads the size from IHDR", () => {
    expect(pngSize(pngHeader(128, 160))).toEqual({ width: 128, height: 160 });
  });

  it("refuses anything that is not a PNG", () => {
    const gif = new TextEncoder().encode("GIF89a........................");
    expect(pngSize(gif)).toBeNull();
    expect(pngSize(pngHeader(1, 1).subarray(0, 20))).toBeNull();
  });
});

describe("suggestFootprint", () => {
  it("reads art drawn at the map's scale", () => {
    expect([64, 128, 192, 256].map(suggestFootprint)).toEqual([1, 2, 3, 4]);
  });

  it("reads art drawn at an exact multiple", () => {
    expect(suggestFootprint(384)).toBe(3); // 3x3 at 2x
    expect(suggestFootprint(768)).toBe(4); // 4x4 at 3x
  });

  it("rounds anything else, inside the map's limits", () => {
    expect(suggestFootprint(100)).toBe(2);
    expect(suggestFootprint(10)).toBe(1);
    expect(suggestFootprint(2000)).toBe(4);
  });
});

describe("spriteLayout", () => {
  it("stands art drawn at scale on its lot's bottom corner", () => {
    // A 2x2 lot is 128 wide and its bottom corner is 64 below its top vertex.
    expect(spriteLayout({ width: 128, height: 160, footprint_w: 2, footprint_h: 2 })).toEqual({
      width: 128,
      height: 160,
      originX: 64,
      originY: 96,
      crisp: true,
    });
  });

  it("puts the top vertex where the lot's left run ends on an uneven lot", () => {
    // 3 wide, 1 deep: the lot spans x from -32 to +96 around its top vertex.
    const layout = spriteLayout({ width: 128, height: 100, footprint_w: 3, footprint_h: 1 });
    expect(layout.originX).toBe(32);
    expect(layout.originY).toBe(100 - 64);
  });

  it("scales other sizes to the lot, and says when pixels stay whole", () => {
    expect(spriteLayout({ width: 256, height: 320, footprint_w: 2, footprint_h: 2 })).toMatchObject({
      width: 128,
      height: 160,
      crisp: true,
    });
    expect(spriteLayout({ width: 100, height: 100, footprint_w: 1, footprint_h: 1 })).toMatchObject({
      width: 64,
      height: 64,
      crisp: false,
    });
  });
});

describe("hitAreaFromPixels", () => {
  it("outlines the opaque pixels by their corners", () => {
    const rgba = pixels(4, 4, [
      [1, 1],
      [2, 1],
      [1, 2],
      [2, 2],
    ]);
    expect(asSet(hitAreaFromPixels(rgba, 4, 4))).toEqual(new Set(["1,1", "3,1", "3,3", "1,3"]));
  });

  it("is convex across a notch", () => {
    // An L: the hull bridges the missing corner.
    const rgba = pixels(3, 3, [
      [0, 0],
      [0, 1],
      [0, 2],
      [1, 2],
      [2, 2],
    ]);
    expect(asSet(hitAreaFromPixels(rgba, 3, 3))).toEqual(new Set(["0,0", "1,0", "3,2", "3,3", "0,3"]));
  });

  it("ignores faint pixels and gives up on an empty image", () => {
    expect(hitAreaFromPixels(pixels(2, 2, [[0, 0]], 10), 2, 2)).toBeNull();
    expect(hitAreaFromPixels(pixels(2, 2, []), 2, 2)).toBeNull();
  });
});

describe("parseHitArea", () => {
  it("accepts points inside the image", () => {
    expect(parseHitArea(" 0,0  4,0 4,4 ", 4, 4)).toBe("0,0 4,0 4,4");
  });

  it("refuses too few points, junk, and points outside the image", () => {
    expect(parseHitArea("0,0 1,1", 4, 4)).toBeNull();
    expect(parseHitArea("0,0 1,1 x,2", 4, 4)).toBeNull();
    expect(parseHitArea("0,0 9,0 4,4", 4, 4)).toBeNull();
    expect(parseHitArea("0,0 -1,0 4,4", 4, 4)).toBeNull();
  });
});

describe("lotTiles", () => {
  it("draws a 1x1 lot as the diamond at the foot of the image", () => {
    expect(lotTiles(1, 1, 128)).toEqual([
      [
        { x: 32, y: 96 },
        { x: 64, y: 112 },
        { x: 32, y: 128 },
        { x: 0, y: 112 },
      ],
    ]);
  });

  it("lays a bigger lot out the way the map does", () => {
    const tiles = lotTiles(2, 1, 100);
    expect(tiles).toHaveLength(2);
    // The second tile sits where tileToScreen puts tile (1, 0) relative to (0, 0).
    const step = tileToScreen(1, 0);
    expect(tiles[1]![0]).toEqual({ x: tiles[0]![0]!.x + step.x, y: tiles[0]![0]!.y + step.y });
    // And the lot's bottom corner is the image's bottom row.
    expect(Math.max(...tiles.flat().map((p) => p.y))).toBe(100);
  });
});
