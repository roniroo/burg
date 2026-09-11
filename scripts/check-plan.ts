/**
 * Plans: the caps, the collaborator gate, and what a lapse does.
 *
 * Asserted against the database with a really signed-in client, for the same
 * reason check-members.ts is: hiding the invite form is a courtesy, and a test
 * that only checked the form would pass just as happily if the policy were
 * missing. Somebody who can reach PostgREST with an anon key and a session is
 * the threat model, not somebody who can click.
 *
 * The caps are exercised on a *throwaway* city rather than the demo one. The
 * building cap is 50, and proving the boundary means inserting 50 buildings;
 * doing that to the seeded city would leave it unrecognisable for every suite
 * that runs afterwards. The scratch city is deleted at the end, cascade and
 * all.
 *
 * Note the triggers fire for the service role too -- RLS is bypassed by it,
 * triggers are not -- which is why the cap assertions below can use `admin`
 * and still be testing the real boundary.
 */
import { config } from "dotenv";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../lib/database.types";
import { FREE_LIMITS } from "../lib/plan";
import { smokeCity, SMOKE_EMAIL } from "./smoke-city";

config({ path: ".env.local", quiet: true });
const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;
const admin = createClient<Database>(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const results: string[] = [];
const check = (n: string, ok: boolean, d = "") => {
  const line = `${ok ? "PASS" : "FAIL"}  ${n}${d ? ` — ${d}` : ""}`;
  console.log(line);
  results.push(line);
};

const PASSWORD = "a-plan-password-for-checks";

async function clientFor(email: string): Promise<SupabaseClient<Database>> {
  const c = createClient<Database>(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error } = await c.auth.signInWithPassword({ email, password: PASSWORD });
  if (error) throw new Error(`could not sign in ${email}: ${error.message}`);
  return c;
}

async function setPlan(userId: string, status: string | null) {
  if (status === null) {
    await admin.from("subscriptions").delete().eq("user_id", userId);
    return;
  }
  await admin
    .from("subscriptions")
    .upsert({ user_id: userId, status, updated_at: new Date().toISOString() }, { onConflict: "user_id" });
}

// --------------------------------------------------------------------------
// A throwaway owner with a throwaway city
// --------------------------------------------------------------------------
const OWNER = `plan+${Date.now()}@burg.local`;
const { data: madeOwner } = await admin.auth.admin.createUser({
  email: OWNER,
  password: PASSWORD,
  email_confirm: true,
});
const ownerId = madeOwner.user!.id;

const cityId = crypto.randomUUID();
await admin.from("cities").insert({
  id: cityId,
  owner_id: ownerId,
  name: "Capville",
  slug: "capville",
  width: 80,
  height: 80,
  seed: 1,
});
await admin.from("city_members").insert({ city_id: cityId, user_id: ownerId, role: "owner" });
check("a scratch city exists to cap", true, `${OWNER} owns Capville`);

// --------------------------------------------------------------------------
// The district cap
// --------------------------------------------------------------------------
const districtIds: string[] = [];
let districtRefusedAt: number | null = null;

for (let i = 0; i < FREE_LIMITS.districts + 1; i++) {
  const id = crypto.randomUUID();
  const { error } = await admin.from("neighborhoods").insert({
    id,
    city_id: cityId,
    name: `District ${i}`,
    slug: `district-${i}`,
    biome: "downtown",
    status: "planning",
    origin_x: i * 10,
    origin_y: 0,
    width: 9,
    height: 9,
    position: i,
  });
  if (error) {
    districtRefusedAt = i;
    check(
      "the district cap is a real trigger, not a UI check",
      /BURG_FREE_DISTRICT_CAP/.test(error.message),
      error.message.slice(0, 80),
    );
    break;
  }
  districtIds.push(id);
}

check(
  `a free city stops at ${FREE_LIMITS.districts} districts`,
  districtRefusedAt === FREE_LIMITS.districts,
  districtRefusedAt === null ? "never refused" : `refused the ${districtRefusedAt! + 1}th`,
);
// This is the drift guard: the number in lib/plan.ts and the number the
// database enforces are compared by behaviour, not by reading two constants.
check(
  "the database enforces the same number lib/plan.ts prints",
  districtIds.length === FREE_LIMITS.districts,
  `${districtIds.length} accepted, lib/plan.ts says ${FREE_LIMITS.districts}`,
);

// --------------------------------------------------------------------------
// The building cap
// --------------------------------------------------------------------------
const hood = districtIds[0]!;
const lots = Array.from({ length: FREE_LIMITS.buildings }, (_, i) => ({
  city_id: cityId,
  neighborhood_id: hood,
  title: `Tower ${i}`,
  artifact_type: "doc" as const,
  sprite_key: "library",
  tile_x: 40 + (i % 20),
  tile_y: 40 + Math.floor(i / 20),
}));
const { error: fillError } = await admin.from("buildings").insert(lots);
check(
  `${FREE_LIMITS.buildings} buildings fit on the free plan`,
  !fillError,
  fillError?.message ?? "all accepted",
);

const { error: overError } = await admin.from("buildings").insert({
  city_id: cityId,
  neighborhood_id: hood,
  title: "One too many",
  artifact_type: "doc",
  sprite_key: "library",
  tile_x: 70,
  tile_y: 70,
});
check(
  `the ${FREE_LIMITS.buildings + 1}st building is refused`,
  !!overError && /BURG_FREE_BUILDING_CAP/.test(overError.message),
  overError ? overError.message.slice(0, 60) : "INSERTED",
);

// Paying lifts it rather than raising it.
await setPlan(ownerId, "active");
const { error: paidBuild } = await admin.from("buildings").insert({
  city_id: cityId,
  neighborhood_id: hood,
  title: "Allowed now",
  artifact_type: "doc",
  sprite_key: "library",
  tile_x: 70,
  tile_y: 70,
});
check("paying lifts the building cap", !paidBuild, paidBuild?.message ?? "built");

const { error: paidDistrict } = await admin.from("neighborhoods").insert({
  city_id: cityId,
  name: "District paid",
  slug: "district-paid",
  biome: "harbor",
  status: "planning",
  origin_x: 60,
  origin_y: 60,
  width: 9,
  height: 9,
  position: 99,
});
check("paying lifts the district cap", !paidDistrict, paidDistrict?.message ?? "founded");

// --------------------------------------------------------------------------
// Collaborators are the paid feature
// --------------------------------------------------------------------------
const ownerDb = await clientFor(OWNER);

await setPlan(ownerId, "none");
const { error: freeInvite } = await ownerDb
  .from("city_invites")
  .insert({ city_id: cityId, email: "someone@else.test", role: "viewer" });
check("a free owner cannot invite anyone", !!freeInvite, freeInvite ? "refused" : "INVITED");

await setPlan(ownerId, "active");
const { error: paidInvite } = await ownerDb
  .from("city_invites")
  .insert({ city_id: cityId, email: "someone@else.test", role: "viewer" });
check("a paying owner can invite", !paidInvite, paidInvite?.message ?? "invited");

// A comped account is entitled without any Stripe object behind it.
await setPlan(ownerId, "comped");
const { error: compedInvite } = await ownerDb
  .from("city_invites")
  .insert({ city_id: cityId, email: "comped@else.test", role: "viewer" });
check("a comped owner can invite", !compedInvite, compedInvite?.message ?? "invited");

// past_due keeps working: Stripe is still retrying, and taking the
// collaborators away over a card that needs updating punishes the wrong thing.
await setPlan(ownerId, "past_due");
const { error: duePastInvite } = await ownerDb
  .from("city_invites")
  .insert({ city_id: cityId, email: "pastdue@else.test", role: "viewer" });
check("past_due still counts as paid", !duePastInvite, duePastInvite?.message ?? "invited");

// --------------------------------------------------------------------------
// What a lapse does, and what it must not do
// --------------------------------------------------------------------------
await setPlan(ownerId, "canceled");

const { error: lapsedInvite } = await ownerDb
  .from("city_invites")
  .insert({ city_id: cityId, email: "after@lapse.test", role: "viewer" });
check("a lapsed owner cannot invite", !!lapsedInvite, lapsedInvite ? "refused" : "INVITED");

// The point of splitting that `for all` policy: cleaning up must survive the
// lapse, or somebody is left with invitations they cannot cancel.
const { data: pending } = await admin
  .from("city_invites")
  .select("id")
  .eq("city_id", cityId)
  .limit(1)
  .maybeSingle();
await ownerDb.from("city_invites").delete().eq("id", pending!.id);
const { data: stillPending } = await admin
  .from("city_invites")
  .select("id")
  .eq("id", pending!.id)
  .maybeSingle();
check("a lapsed owner can still revoke an invitation", !stillPending, "revoked");

// An existing member is never evicted by a lapse. Revoking access to data
// people rely on, because a card expired, is data loss with a billing excuse.
const GUEST = `planguest+${Date.now()}@burg.local`;
const { data: madeGuest } = await admin.auth.admin.createUser({
  email: GUEST,
  password: PASSWORD,
  email_confirm: true,
});
const guestId = madeGuest.user!.id;
await admin.from("city_members").insert({ city_id: cityId, user_id: guestId, role: "viewer" });

const guestDb = await clientFor(GUEST);
const { data: guestSees } = await guestDb.from("buildings").select("id").eq("city_id", cityId);
check(
  "an existing member keeps reading a lapsed city",
  (guestSees ?? []).length > 0,
  `${(guestSees ?? []).length} buildings`,
);

// --------------------------------------------------------------------------
// Claiming is checked when access is granted, not when the invite was sent
// --------------------------------------------------------------------------
const CLAIMER = `planclaim+${Date.now()}@burg.local`;
const { data: madeClaimer } = await admin.auth.admin.createUser({
  email: CLAIMER,
  password: PASSWORD,
  email_confirm: true,
});
const claimerId = madeClaimer.user!.id;

await setPlan(ownerId, "active");
await ownerDb.from("city_invites").insert({ city_id: cityId, email: CLAIMER, role: "viewer" });
await setPlan(ownerId, "canceled");

const claimerDb = await clientFor(CLAIMER);
const { error: claimWhileLapsed } = await claimerDb
  .from("city_members")
  .insert({ city_id: cityId, user_id: claimerId, role: "viewer" });
check(
  "an invitation cannot be claimed while the owner has lapsed",
  !!claimWhileLapsed,
  claimWhileLapsed ? "refused" : "CLAIMED",
);

await setPlan(ownerId, "active");
const { error: claimWhenPaid } = await claimerDb
  .from("city_members")
  .insert({ city_id: cityId, user_id: claimerId, role: "viewer" });
check(
  "and is claimable again once they pay",
  !claimWhenPaid,
  claimWhenPaid?.message ?? "claimed",
);

// --------------------------------------------------------------------------
// Nobody grants themselves a plan
// --------------------------------------------------------------------------
// The whole reason the table has no insert or update policy. A user holding
// only the anon key and their own session must not be able to write this row,
// or the paid plan is free to anyone who can read the network tab.
const selfGrant = await guestDb
  .from("subscriptions")
  .insert({ user_id: guestId, status: "active" });
const { data: afterSelfGrant } = await admin
  .from("subscriptions")
  .select("status")
  .eq("user_id", guestId)
  .maybeSingle();
check(
  "a user cannot grant themselves a subscription",
  !afterSelfGrant,
  selfGrant.error ? "refused" : afterSelfGrant ? `WROTE ${afterSelfGrant.status}` : "no row",
);

await setPlan(guestId, "none");
const selfUpgrade = await guestDb
  .from("subscriptions")
  .update({ status: "active" })
  .eq("user_id", guestId);
const { data: afterSelfUpgrade } = await admin
  .from("subscriptions")
  .select("status")
  .eq("user_id", guestId)
  .maybeSingle();
check(
  "nor upgrade a row they already have",
  afterSelfUpgrade?.status === "none",
  selfUpgrade.error ? "refused with an error" : `matched no rows; still "${afterSelfUpgrade?.status}"`,
);

const { data: peek } = await guestDb
  .from("subscriptions")
  .select("status")
  .eq("user_id", ownerId)
  .maybeSingle();
check("nor read somebody else's billing state", !peek, peek ? `SAW ${peek.status}` : "invisible");

// --------------------------------------------------------------------------
// The one question a member may ask
// --------------------------------------------------------------------------
await setPlan(ownerId, "active");
const { data: memberSees } = await guestDb.rpc("city_is_paid", { target_city: cityId });
check("a member can ask whether the city is paid", memberSees === true, String(memberSees));

const strangerCity = await smokeCity(admin);
const { data: strangerSees } = await guestDb.rpc("city_is_paid", { target_city: strangerCity.id });
check(
  "a stranger cannot probe a city they are not in",
  strangerSees === false,
  `${SMOKE_EMAIL}'s city reported ${strangerSees}`,
);

// --------------------------------------------------------------------------
// Founding still works on the free plan
// --------------------------------------------------------------------------
// The regression that 20260911160000_found_a_city.sql fixes: a brand-new user
// could not insert their own membership row, so `ensureCity` silently left
// them with no city. It failed quietly for months because every account was
// made by `npm run seed`, which runs as the service role.
const FOUNDER = `planfound+${Date.now()}@burg.local`;
const { data: madeFounder } = await admin.auth.admin.createUser({
  email: FOUNDER,
  password: PASSWORD,
  email_confirm: true,
});
const founderId = madeFounder.user!.id;
const founderDb = await clientFor(FOUNDER);

const ownCityId = crypto.randomUUID();
const { error: foundCity } = await founderDb.from("cities").insert({
  id: ownCityId,
  owner_id: founderId,
  name: "Foundling",
  slug: "foundling",
  width: 40,
  height: 40,
  seed: 1,
});
const { error: foundMember } = await founderDb
  .from("city_members")
  .insert({ city_id: ownCityId, user_id: founderId, role: "owner" });
const { data: readsOwn } = await founderDb.from("cities").select("id").eq("id", ownCityId);

check("a new user can found a city as themselves", !foundCity && !foundMember,
  foundMember?.message ?? "founded");
check("and can then read it back", (readsOwn ?? []).length === 1, `${(readsOwn ?? []).length} rows`);

// ...but cannot make themselves the owner of somebody else's city.
const { error: hijack } = await founderDb
  .from("city_members")
  .insert({ city_id: cityId, user_id: founderId, role: "owner" });
check("but cannot declare themselves owner of another city", !!hijack,
  hijack ? "refused" : "HIJACKED");

// --------------------------------------------------------------------------
// Clean up
// --------------------------------------------------------------------------
await admin.from("cities").delete().eq("id", cityId);
await admin.from("cities").delete().eq("id", ownCityId);
for (const id of [ownerId, guestId, claimerId, founderId]) {
  await admin.auth.admin.deleteUser(id);
}

console.log(`\n${results.filter((r) => r.startsWith("PASS")).length}/${results.length} passed`);