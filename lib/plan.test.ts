import { describe, expect, it } from "vitest";
import {
  allowance,
  allowancesFor,
  capReached,
  capViolation,
  ENTITLING_STATUSES,
  FREE_LIMITS,
  isEntitled,
} from "./plan";

describe("isEntitled", () => {
  it("accepts an active subscription", () => {
    expect(isEntitled("active")).toBe(true);
  });

  it("accepts a trial", () => {
    expect(isEntitled("trialing")).toBe(true);
  });

  it("keeps a past_due subscription entitled", () => {
    // Stripe is still retrying. Losing your collaborators because a card
    // expired is the wrong punishment for a retryable failure.
    expect(isEntitled("past_due")).toBe(true);
  });

  it("accepts a comped account", () => {
    expect(isEntitled("comped")).toBe(true);
  });

  it("refuses the statuses that mean Stripe gave up", () => {
    expect(isEntitled("canceled")).toBe(false);
    expect(isEntitled("unpaid")).toBe(false);
    expect(isEntitled("incomplete_expired")).toBe(false);
  });

  it("refuses a subscription that never started paying", () => {
    expect(isEntitled("incomplete")).toBe(false);
  });

  it("refuses nothing at all", () => {
    // A user with no subscriptions row at all is the common case, not an edge.
    expect(isEntitled(null)).toBe(false);
    expect(isEntitled(undefined)).toBe(false);
    expect(isEntitled("")).toBe(false);
    expect(isEntitled("none")).toBe(false);
  });

  it("refuses a status Stripe has not invented yet", () => {
    // The list is an allowlist for this reason: an unknown status should leave
    // someone unentitled rather than let anything through.
    expect(isEntitled("paused")).toBe(false);
    expect(isEntitled("something_new")).toBe(false);
  });
});

describe("allowance", () => {
  it("counts what is left", () => {
    expect(allowance(2, 5)).toEqual({ used: 2, limit: 5, remaining: 3, full: false });
  });

  it("is full at the limit, not past it", () => {
    // The trigger refuses the insert that would make it 6, so 5 of 5 is the
    // state a free city actually sits in.
    expect(allowance(5, 5).full).toBe(true);
    expect(allowance(5, 5).remaining).toBe(0);
  });

  it("never reports a negative remainder", () => {
    // Reachable: a city built while paid, then lapsed. Being over the cap is
    // not a debt, and the UI must not render "-3 left".
    expect(allowance(9, 5)).toEqual({ used: 9, limit: 5, remaining: 0, full: true });
  });

  it("is never full when uncapped", () => {
    expect(allowance(9000, null)).toEqual({
      used: 9000,
      limit: null,
      remaining: null,
      full: false,
    });
  });
});

describe("allowancesFor", () => {
  it("caps a free city at the documented numbers", () => {
    const a = allowancesFor(false, { districts: 3, buildings: 8 });
    expect(a.districts.limit).toBe(FREE_LIMITS.districts);
    expect(a.buildings.limit).toBe(FREE_LIMITS.buildings);
  });

  it("lifts both caps when paid rather than raising them", () => {
    const a = allowancesFor(true, { districts: 3, buildings: 8 });
    expect(a.districts.limit).toBeNull();
    expect(a.buildings.limit).toBeNull();
  });

  it("leaves the seeded city with room", () => {
    // The seed is 3 districts and 8 buildings. A free plan that was already
    // full on arrival would make the first run look broken.
    const a = allowancesFor(false, { districts: 3, buildings: 8 });
    expect(a.districts.full).toBe(false);
    expect(a.buildings.full).toBe(false);
  });
});

describe("capViolation", () => {
  it("recognises each trigger by its marker", () => {
    expect(capViolation("BURG_FREE_DISTRICT_CAP: the free plan covers 5 districts")).toBe(
      "district",
    );
    expect(capViolation("BURG_FREE_BUILDING_CAP: the free plan covers 50 buildings")).toBe(
      "building",
    );
  });

  it("ignores anything else", () => {
    expect(capViolation("duplicate key value violates unique constraint")).toBeNull();
    expect(capViolation(undefined)).toBeNull();
    expect(capViolation(null)).toBeNull();
  });
});

describe("the messages", () => {
  it("name the actual limit, so the wall has a visible shape", () => {
    expect(capReached("district")).toContain(String(FREE_LIMITS.districts));
    expect(capReached("building")).toContain(String(FREE_LIMITS.buildings));
  });
});

describe("the entitling list", () => {
  it("holds no duplicates", () => {
    expect(new Set(ENTITLING_STATUSES).size).toBe(ENTITLING_STATUSES.length);
  });
});
