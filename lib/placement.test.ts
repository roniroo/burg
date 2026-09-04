import { describe, expect, it } from "vitest";
import { canPlace, findEmptyLot, overlaps, tilesOf, type Footprint } from "./placement";

const region = { origin_x: 2, origin_y: 2, width: 6, height: 5 };
const city = { width: 40, height: 40 };
const allGrass = () => "grass" as const;
const at = (x: number, y: number, w = 1, h = 1): Footprint => ({
  tile_x: x,
  tile_y: y,
  footprint_w: w,
  footprint_h: h,
});

describe("overlaps", () => {
  it("is false for adjacent footprints", () => {
    // The database constraint allows this; the UI must agree.
    expect(overlaps(at(0, 0, 2, 2), at(2, 0))).toBe(false);
    expect(overlaps(at(0, 0, 2, 2), at(0, 2))).toBe(false);
  });

  it("is true when a 1x1 sits inside a 2x2", () => {
    // The case the origin-uniqueness index alone would have missed.
    expect(overlaps(at(0, 0, 2, 2), at(1, 1))).toBe(true);
  });

  it("is symmetric", () => {
    const a = at(3, 3, 2, 2);
    const b = at(4, 4, 2, 2);
    expect(overlaps(a, b)).toBe(overlaps(b, a));
  });

  it("is false for footprints that only share a corner point", () => {
    expect(overlaps(at(0, 0, 2, 2), at(2, 2))).toBe(false);
  });
});

describe("tilesOf", () => {
  it("covers width times height tiles", () => {
    expect(tilesOf(at(1, 1, 3, 2))).toHaveLength(6);
  });
});

describe("canPlace", () => {
  const base = { region, occupied: [], terrainAt: allGrass, city };

  it("accepts an empty in-region lot", () => {
    expect(canPlace({ ...base, footprint: at(3, 3) })).toEqual({ ok: true });
  });

  it("rejects a lot outside the region", () => {
    expect(canPlace({ ...base, footprint: at(0, 0) })).toEqual({ ok: false, reason: "outside-region" });
  });

  it("rejects a footprint that straddles the region edge", () => {
    // The origin is inside, but the far corner is not.
    expect(canPlace({ ...base, footprint: at(7, 3, 2, 2) })).toEqual({
      ok: false,
      reason: "outside-region",
    });
  });

  it("rejects water", () => {
    const terrainAt = (x: number, y: number) => (x === 4 && y === 4 ? ("water" as const) : ("grass" as const));
    expect(canPlace({ ...base, terrainAt, footprint: at(4, 4) })).toEqual({ ok: false, reason: "water" });
  });

  it("rejects a footprint whose far tile is water", () => {
    const terrainAt = (x: number, y: number) => (x === 4 && y === 4 ? ("water" as const) : ("grass" as const));
    expect(canPlace({ ...base, terrainAt, footprint: at(3, 3, 2, 2) }).ok).toBe(false);
  });

  it("rejects an occupied lot", () => {
    expect(canPlace({ ...base, occupied: [at(3, 3)], footprint: at(3, 3) })).toEqual({
      ok: false,
      reason: "occupied",
    });
  });

  it("allows building directly beside an existing lot", () => {
    expect(canPlace({ ...base, occupied: [at(3, 3, 2, 2)], footprint: at(5, 3) })).toEqual({ ok: true });
  });

  it("rejects negative coordinates as off the city", () => {
    const wide = { origin_x: -5, origin_y: -5, width: 20, height: 20 };
    expect(canPlace({ ...base, region: wide, footprint: at(-1, -1) })).toEqual({
      ok: false,
      reason: "outside-city",
    });
  });
});

describe("findEmptyLot", () => {
  const base = { region, occupied: [], terrainAt: allGrass, city };

  it("returns the region's first tile when nothing is built", () => {
    expect(findEmptyLot(base)).toEqual({ tile_x: 2, tile_y: 2 });
  });

  it("skips occupied lots in reading order", () => {
    const occupied = [at(2, 2), at(3, 2)];
    expect(findEmptyLot({ ...base, occupied })).toEqual({ tile_x: 4, tile_y: 2 });
  });

  it("is deterministic, so promoting twice does not reshuffle the city", () => {
    const occupied = [at(2, 2), at(4, 2), at(3, 3)];
    const first = findEmptyLot({ ...base, occupied });
    const second = findEmptyLot({ ...base, occupied });
    expect(first).toEqual(second);
  });

  it("skips water", () => {
    const terrainAt = (_x: number, y: number) => (y === 2 ? ("water" as const) : ("grass" as const));
    expect(findEmptyLot({ ...base, terrainAt })).toEqual({ tile_x: 2, tile_y: 3 });
  });

  it("returns null when the region is full", () => {
    const occupied: Footprint[] = [];
    for (let y = 2; y < 7; y++) for (let x = 2; x < 8; x++) occupied.push(at(x, y));
    expect(findEmptyLot({ ...base, occupied })).toBeNull();
  });

  it("finds a lot large enough for a bigger footprint", () => {
    // A 2x2 cannot start on the last column of the region.
    const occupied: Footprint[] = [];
    for (let x = 2; x < 8; x++) occupied.push(at(x, 2));
    const lot = findEmptyLot({ ...base, occupied, footprintW: 2, footprintH: 2 });
    expect(lot).toEqual({ tile_x: 2, tile_y: 3 });
  });
});
