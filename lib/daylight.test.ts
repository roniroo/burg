import { describe, expect, it } from "vitest";
import { daylightAt, hourOf } from "./daylight";

const at = (hour: number, minute = 0) => {
  const d = new Date(2026, 8, 4);
  d.setHours(hour, minute, 0, 0);
  return d;
};

describe("hourOf", () => {
  it("reads the local hour as a float", () => {
    expect(hourOf(at(13, 30))).toBe(13.5);
    expect(hourOf(at(0, 0))).toBe(0);
  });
});

describe("daylightAt", () => {
  it("names the phase for each part of the day", () => {
    expect(daylightAt(at(2)).phase).toBe("night");
    expect(daylightAt(at(6)).phase).toBe("dawn");
    expect(daylightAt(at(12)).phase).toBe("day");
    expect(daylightAt(at(19)).phase).toBe("dusk");
    expect(daylightAt(at(23)).phase).toBe("night");
  });

  it("lights the lamps at dusk and through the night, never at noon", () => {
    expect(daylightAt(at(12)).lampsOn).toBe(false);
    expect(daylightAt(at(19)).lampsOn).toBe(true);
    expect(daylightAt(at(2)).lampsOn).toBe(true);
  });

  it("gives every phase a sky that is not the day sky", () => {
    const day = daylightAt(at(12));
    for (const hour of [2, 6, 19]) {
      expect(daylightAt(at(hour)).skyTop).not.toBe(day.skyTop);
    }
  });

  it("runs sunProgress from 0 at sunrise to 1 at sunset", () => {
    expect(daylightAt(at(6)).sunProgress).toBe(0);
    expect(daylightAt(at(20)).sunProgress).toBe(1);
    expect(daylightAt(at(13)).sunProgress).toBeCloseTo(0.5, 1);
  });

  it("clamps sunProgress outside daylight rather than going negative", () => {
    expect(daylightAt(at(3)).sunProgress).toBe(0);
    expect(daylightAt(at(23)).sunProgress).toBe(1);
  });

  it("makes shadows shortest at solar noon and longest at the horizons", () => {
    const noon = daylightAt(at(13)).shadowScale;
    const morning = daylightAt(at(7)).shadowScale;
    const evening = daylightAt(at(19)).shadowScale;
    expect(noon).toBeLessThan(morning);
    expect(noon).toBeLessThan(evening);
    expect(noon).toBeCloseTo(1, 1);
  });

  it("never returns a shadow that would invert or vanish", () => {
    for (let hour = 0; hour < 24; hour++) {
      expect(daylightAt(at(hour)).shadowScale).toBeGreaterThanOrEqual(1);
    }
  });

  it("lays no tint over the middle of the day", () => {
    expect(daylightAt(at(12)).ambientOpacity).toBe(0);
    expect(daylightAt(at(2)).ambientOpacity).toBeGreaterThan(0);
  });

  it("is a pure function of the clock", () => {
    expect(daylightAt(at(9, 15))).toEqual(daylightAt(at(9, 15)));
  });
});
