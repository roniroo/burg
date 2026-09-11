/**
 * What a plan allows.
 *
 * Pure, like the rest of `lib/` -- no React, no database, no Stripe -- which is
 * why it carries the unit tests and why the UI, the server actions and the
 * check suite can all agree on one set of numbers.
 *
 * The numbers and the status list are *mirrored* in
 * `supabase/migrations/20260911170000_plans.sql`, which is where they are
 * actually enforced. This module is the readable copy and the source of the
 * error messages; the database is the boundary. `scripts/check-plan.ts` reads
 * both and fails if they diverge, because two copies of a number is exactly the
 * kind of thing that rots quietly.
 *
 * Why these numbers: the seed alone is three districts and eight buildings, a
 * district holds about 48 lots, and 50 buildings is roughly where somebody has
 * stopped trying Burg and started depending on it. Below about 25 you are
 * taxing evaluation rather than charging for use.
 */

export const FREE_LIMITS = {
  districts: 5,
  buildings: 50,
} as const;

/**
 * Subscription statuses that entitle.
 *
 * All but `comped` are Stripe's own. `past_due` is here deliberately: Stripe is
 * still retrying the payment at that point, and taking someone's collaborators
 * away over a card that needs updating punishes the wrong thing. When the
 * retries run out Stripe moves it to `canceled` or `unpaid`, neither of which
 * is on this list.
 *
 * `comped` is Burg's own: access granted with no Stripe objects behind it.
 */
export const ENTITLING_STATUSES = ["active", "trialing", "past_due", "comped"] as const;

export type EntitlingStatus = (typeof ENTITLING_STATUSES)[number];

/** The plan as the app carries it around. */
export type Plan = {
  paid: boolean;
  status: string;
  /** Present for a real Stripe subscription; null for free and for comped. */
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
};

export const FREE_PLAN: Plan = {
  paid: false,
  status: "none",
  currentPeriodEnd: null,
  cancelAtPeriodEnd: false,
};

export function isEntitled(status: string | null | undefined): boolean {
  if (!status) return false;
  return (ENTITLING_STATUSES as readonly string[]).includes(status);
}

/** What is left of a capped allowance. `limit: null` means uncapped. */
export type Allowance = {
  used: number;
  limit: number | null;
  /** null when uncapped. Never negative -- being over a cap is not owed back. */
  remaining: number | null;
  full: boolean;
};

export function allowance(used: number, limit: number | null): Allowance {
  if (limit === null) return { used, limit: null, remaining: null, full: false };
  return {
    used,
    limit,
    remaining: Math.max(0, limit - used),
    full: used >= limit,
  };
}

export type Usage = { districts: number; buildings: number };

export type Allowances = { districts: Allowance; buildings: Allowance };

/**
 * Both allowances for a city at once.
 *
 * Paying lifts the caps entirely rather than raising them, which is the whole
 * argument in the README: metering the size of a 3.4 KB city would be
 * manufacturing scarcity, so the paid tier does not meter it at all.
 */
export function allowancesFor(paid: boolean, usage: Usage): Allowances {
  return {
    districts: allowance(usage.districts, paid ? null : FREE_LIMITS.districts),
    buildings: allowance(usage.buildings, paid ? null : FREE_LIMITS.buildings),
  };
}

/**
 * What to say when somebody hits a cap.
 *
 * Names the limit and the way out, and does not apologise. A wall you cannot
 * see the shape of is the thing that feels like a bug.
 */
export function capReached(kind: "district" | "building"): string {
  return kind === "district"
    ? `The free plan covers ${FREE_LIMITS.districts} districts. Upgrade to found more.`
    : `The free plan covers ${FREE_LIMITS.buildings} buildings. Upgrade to raise more.`;
}

export const COLLABORATORS_ARE_PAID =
  "Inviting people is part of the paid plan. Upgrade to share this city.";

/**
 * Does a database error look like one of the cap triggers firing?
 *
 * The actions check the caps themselves so they can say something useful
 * first; this is for the race where two tabs both passed that check, and for
 * any path that reaches the insert without asking.
 */
export function capViolation(message: string | undefined | null): "district" | "building" | null {
  if (!message) return null;
  if (message.includes("BURG_FREE_DISTRICT_CAP")) return "district";
  if (message.includes("BURG_FREE_BUILDING_CAP")) return "building";
  return null;
}
