/**
 * Collaboration: invitations, roles, and what each role may actually do.
 *
 * The important assertions here are made against the database with a real
 * signed-in client, not against the UI. Hiding a button is a courtesy; RLS is
 * the thing that has to refuse a viewer, and a test that only checks the
 * button would pass just as happily if the policies were missing.
 */
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import { config } from "dotenv";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../lib/database.types";
import { smokeCity } from "./smoke-city";
import { until, untilCount, untilText } from "./until";

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

const cookieLine = readFileSync("/tmp/burg-cookie.txt", "utf-8").trim();
const eq = cookieLine.indexOf("=");
const cookie = { name: cookieLine.slice(0, eq), value: cookieLine.slice(eq + 1), domain: "localhost", path: "/" };

const city = await smokeCity(admin);
const GUEST = `guest+${Date.now()}@burg.local`;
const GUEST_PASSWORD = "a-guest-password-for-checks";

/** A client that is really signed in as someone, so RLS applies to it. */
async function clientFor(email: string, password: string): Promise<SupabaseClient<Database>> {
  const c = createClient<Database>(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error } = await c.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`could not sign in ${email}: ${error.message}`);
  return c;
}

// Signups are closed, so the guest is made the way a real one would be.
const { data: made } = await admin.auth.admin.createUser({
  email: GUEST, password: GUEST_PASSWORD, email_confirm: true,
});
const guestId = made.user!.id;
check("a guest account can be created", !!guestId, GUEST);

// --- the owner invites, through the UI ------------------------------------
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
await context.addCookies([cookie]);
const page = await context.newPage();
const errors: string[] = [];
page.on("pageerror", (e) => errors.push(String(e)));

await page.goto("http://localhost:3000/directory", { waitUntil: "networkidle" });
check("the directory has a People section", (await page.getByRole("heading", { name: /^people$/i }).count()) === 1);
check("the owner sees the invite form", (await page.locator("#invite-email").count()) === 1);

await page.fill("#invite-email", GUEST);
await page.selectOption("#invite-role", "viewer");
await page.getByRole("button", { name: /send invite/i }).click();

const invite = await until(
  async () =>
    (
      await admin
        .from("city_invites").select("id, role, email").eq("city_id", city.id).eq("email", GUEST).maybeSingle()
    ).data,
  (row) => !!row,
);
check("the invitation is recorded", !!invite, invite?.role ?? "none");

// Two separate arrivals: the row, and the page catching up to it. Waiting
// only for the row asserts the list before it has re-rendered -- which is
// exactly what the old blanket sleep was quietly covering for.
const pendingList = await untilText(page.locator("body"), (t) => /invited, not yet arrived/i.test(t));
check("it is listed as pending", /invited, not yet arrived/i.test(pendingList));

// --- the guest claims it on sign-in ---------------------------------------
const guestCtx = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
const guestPage = await guestCtx.newPage();
guestPage.on("pageerror", (e) => errors.push(String(e)));
await guestPage.goto("http://localhost:3000/sign-in", { waitUntil: "networkidle" });
await guestPage.fill("#email", GUEST);
await guestPage.fill("#password", GUEST_PASSWORD);
await guestPage.getByRole("button", { name: /^sign in$/i }).last().click();
await guestPage.waitForURL(/\/city/, { timeout: 30000 }).catch(() => {});
check("the guest signs in", /\/city/.test(guestPage.url()), guestPage.url());

const { data: membership } = await admin
  .from("city_members").select("role").eq("city_id", city.id).eq("user_id", guestId).maybeSingle();
check("signing in claims the invitation", membership?.role === "viewer", membership?.role ?? "none");

const { data: leftover } = await admin.from("city_invites").select("id").eq("id", invite?.id ?? "").maybeSingle();
check("the claimed invitation is consumed", !leftover);

// --- what a viewer may actually do ----------------------------------------
const guestDb = await clientFor(GUEST, GUEST_PASSWORD);

// Worth stating plainly, because the log is confusing otherwise: RLS does not
// raise on a refused UPDATE or DELETE. The row is filtered out of the
// statement's view, so it matches nothing and reports success having changed
// nothing. The assertion is therefore always "is the row still as it was",
// never "did the client get an error".
const { data: seen } = await guestDb.from("buildings").select("id").eq("city_id", city.id);
check("a viewer can read the city", (seen ?? []).length > 0, `${(seen ?? []).length} buildings`);

const someBuilding = (seen ?? [])[0]!;
const { error: renameError } = await guestDb
  .from("buildings").update({ title: "viewer was here" }).eq("id", someBuilding.id);
const { data: afterRename } = await admin
  .from("buildings").select("title").eq("id", someBuilding.id).maybeSingle();
check("a viewer cannot rename a building", afterRename?.title !== "viewer was here",
  renameError ? "refused with an error" : `matched no rows; still "${afterRename?.title}"`);

const { error: deleteError } = await guestDb.from("buildings").delete().eq("id", someBuilding.id);
const { data: stillThere } = await admin.from("buildings").select("id").eq("id", someBuilding.id).maybeSingle();
check("a viewer cannot demolish", !!stillThere,
  !stillThere ? "THE BUILDING IS GONE" : deleteError ? "refused with an error" : "matched no rows");

const { data: hood } = await admin.from("neighborhoods").select("id").eq("city_id", city.id).limit(1).single();
const { error: insertError } = await guestDb.from("buildings").insert({
  city_id: city.id, neighborhood_id: hood!.id, title: "viewer's tower",
  artifact_type: "doc", sprite_key: "library", tile_x: 38, tile_y: 38,
});
check("a viewer cannot build", !!insertError, insertError ? "refused" : "INSERTED");

const { error: inviteError } = await guestDb
  .from("city_invites").insert({ city_id: city.id, email: "someone@else.test", role: "editor" });
check("a viewer cannot invite anyone", !!inviteError, inviteError ? "refused" : "INVITED");

// --- the map and directory hide what a viewer cannot do -------------------
// The guest now has two cities: the one they were invited to, and their own,
// which `ensureCity` seeds on first sign-in. `getCurrentCity` prefers a city
// you own, so they land in theirs and have to switch before any of the
// viewer-only assertions below mean anything.
//
// Worth knowing why this appeared: until `20260911160000_found_a_city.sql` the
// guest's own seed failed silently — RLS refused the founding `city_members`
// insert — so they were left with only the shared city and landed on it by
// default. These checks were passing because of that bug, not in spite of it.
await guestPage.goto("http://localhost:3000/city", { waitUntil: "networkidle" });
const switchers = await untilCount(guestPage.locator("#city-switcher"), (n) => n === 1);

check("a guest gets their own city too", switchers === 1,
  "the switcher only renders with more than one city to switch between");

// Switching writes a cookie and then re-renders, so the tell is the select
// showing the city we asked for rather than a couple of seconds passing.
await guestPage.selectOption("#city-switcher", city.id);
await until(
  () => guestPage.locator("#city-switcher").inputValue().catch(() => ""),
  (v) => v === city.id,
);
await guestPage.goto("http://localhost:3000/city", { waitUntil: "networkidle" });
const activeCity = await until(
  () => guestPage.locator("#city-switcher").inputValue().catch(() => ""),
  (v) => v === city.id,
);
check("switching lands them in the shared city", activeCity === city.id);

check("a viewer is offered no Build button",
  (await guestPage.getByRole("button", { name: /^build$/i }).count()) === 0);
check("a viewer is offered no Demolish button",
  (await guestPage.getByRole("button", { name: /^demolish$/i }).count()) === 0);
check("but the city still renders for them",
  (await guestPage.locator("[data-building]").count()) > 0);

await guestPage.goto("http://localhost:3000/directory", { waitUntil: "networkidle" });
check("a viewer sees no delete controls",
  (await guestPage.getByRole("button", { name: /^demolish$/i }).count()) === 0 &&
  (await guestPage.getByRole("button", { name: /dissolve district/i }).count()) === 0);
check("a viewer cannot Start fresh",
  (await guestPage.getByRole("heading", { name: /start fresh/i }).count()) === 0);
check("a viewer can see who else is here",
  (await guestPage.getByRole("heading", { name: /^people$/i }).count()) === 1);
check("a viewer is offered no invite form", (await guestPage.locator("#invite-email").count()) === 0);
check("a viewer can leave", (await guestPage.getByRole("button", { name: /^leave /i }).count()) === 1);

// --- promoted to editor ---------------------------------------------------
await page.goto("http://localhost:3000/directory", { waitUntil: "networkidle" });
await page.selectOption(`#role-${guestId}`, "editor");
const promoted = await until(
  async () =>
    (await admin.from("city_members").select("role").eq("city_id", city.id).eq("user_id", guestId).maybeSingle())
      .data,
  (row) => row?.role === "editor",
);
check("the owner can promote a viewer to editor", promoted?.role === "editor", promoted?.role ?? "");

const editorDb = await clientFor(GUEST, GUEST_PASSWORD);
const { error: editorRename } = await editorDb
  .from("buildings").update({ title: "editor was here" }).eq("id", someBuilding.id);
check("an editor can rename a building", !editorRename, editorRename?.message ?? "renamed");

const { error: editorInvite } = await editorDb
  .from("city_invites").insert({ city_id: city.id, email: "another@else.test", role: "viewer" });
check("an editor still cannot invite", !!editorInvite, editorInvite ? "refused" : "INVITED");

const { error: ownerDemote } = await editorDb
  .from("city_members").update({ role: "viewer" }).eq("city_id", city.id).eq("user_id", (await admin.auth.admin.listUsers({ perPage: 1000 })).data.users.find((u) => u.email === "seedtest@burg.local")!.id);
const { data: ownerRow } = await admin
  .from("city_members").select("role").eq("city_id", city.id).eq("user_id", (await admin.auth.admin.listUsers({ perPage: 1000 })).data.users.find((u) => u.email === "seedtest@burg.local")!.id).maybeSingle();
check("an editor cannot demote the owner", ownerRow?.role === "owner", ownerDemote ? "refused" : ownerRow?.role ?? "");

// --- removal --------------------------------------------------------------
await page.goto("http://localhost:3000/directory", { waitUntil: "networkidle" });
await page.getByRole("button", { name: /^remove$/i }).first().click();
const removed = await until(
  async () =>
    (await admin.from("city_members").select("role").eq("city_id", city.id).eq("user_id", guestId).maybeSingle())
      .data,
  (row) => !row,
);
check("the owner can remove someone", !removed, removed?.role ?? "gone");

const goneDb = await clientFor(GUEST, GUEST_PASSWORD);
const { data: afterRemoval } = await goneDb.from("buildings").select("id").eq("city_id", city.id);
check("a removed person can no longer read the city", (afterRemoval ?? []).length === 0,
  `${(afterRemoval ?? []).length} buildings still visible`);

// Put the renamed building back the way the seed had it.
await admin.from("buildings").update({ title: "Launch Brief" }).eq("id", someBuilding.id);
await admin.auth.admin.deleteUser(guestId);
await admin.from("city_invites").delete().eq("city_id", city.id);

check("no page errors", errors.length === 0, errors.join(" | "));
console.log(`\n${results.filter((r) => r.startsWith("PASS")).length}/${results.length} passed`);
await browser.close();
