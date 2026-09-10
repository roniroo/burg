import { describe, expect, it } from "vitest";
import { propAt } from "./props";

describe("propAt", () => {
  it("is deterministic for a tile", () => {
    for (let i = 0; i < 50; i++) {
      expect(propAt(i, i * 3, 7)).toBe(propAt(i, i * 3, 7));
    }
  });

  it("scatters sparsely", () => {
    let placed = 0;
    for (let x = 0; x < 60; x++) for (let y = 0; y < 60; y++) if (propAt(x, y, 1)) placed++;
    const share = placed / 3600;
    expect(share).toBeGreaterThan(0.08);
    expect(share).toBeLessThan(0.2);
  });

  it("does not band along either axis", () => {
    // A weak hash repeats down a row or column, which on a grid reads as a
    // fence of identical lamp posts rather than as scatter.
    const row = Array.from({ length: 40 }, (_, x) => propAt(x, 12, 3));
    const col = Array.from({ length: 40 }, (_, y) => propAt(12, y, 3));
    expect(new Set(row.filter(Boolean)).size).toBeGreaterThan(1);
    expect(new Set(col.filter(Boolean)).size).toBeGreaterThan(1);
    expect(row.join()).not.toBe(col.join());
  });

  it("gives a different city a different scatter", () => {
    const a = Array.from({ length: 40 }, (_, x) => propAt(x, 5, 1)).join();
    const b = Array.from({ length: 40 }, (_, x) => propAt(x, 5, 2)).join();
    expect(a).not.toBe(b);
  });

  it("never places the fountain, which is a centrepiece not scatter", () => {
    for (let x = 0; x < 120; x++) for (let y = 0; y < 120; y++) expect(propAt(x, y, 4)).not.toBe("fountain");
  });
});
