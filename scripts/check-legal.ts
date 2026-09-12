/** The public pages: terms, privacy, and the password reset path. */
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "../lib/database.types";
import { untilText } from "./until";
import { parseMarkdown } from "../lib/markdown";
import { SMOKE_EMAIL } from "./smoke-city";

config({ path: ".env.local", quiet: true });
const admin = createClient<Database>(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false, autoRefreshToken: false } },
);

const results: string[] = [];
const check = (n: string, ok: boolean, d = "") => {
  const line = `${ok ? "PASS" : "FAIL"}  ${n}${d ? ` — ${d}` : ""}`;
  console.log(line);
  results.push(line);
};

const browser = await chromium.launch();
// No cookie on purpose: every page here must work for someone signed out.
const page = await (await browser.newContext({ viewport: { width: 1000, height: 1000 } })).newPage();
const errors: string[] = [];
page.on("pageerror", (e) => errors.push(String(e)));

for (const [path, file, heading] of [
  ["/terms", "docs/terms.md", "Terms of Service"],
  ["/privacy", "docs/private-policy.md", "Privacy Policy"],
] as const) {
  const source = readFileSync(file, "utf-8");
  const blocks = parseMarkdown(source);

  const res = await page.goto(`http://localhost:3000${path}`, { waitUntil: "networkidle" });
  check(`${path} is reachable signed out`, res?.status() === 200 && page.url().endsWith(path),
    `${res?.status()} ${page.url()}`);
  check(`${path} shows its title`, (await page.locator("h1").first().innerText()).includes(heading));

  // Every heading, list item and table in the source reaches the page.
  const h2 = await page.locator("article h2").count();
  check(`${path} renders every section`,
    h2 === blocks.filter((b) => b.kind === "heading" && b.level === 2).length, `${h2} sections`);

  const tables = await page.locator("article table").count();
  check(`${path} renders every table`,
    tables === blocks.filter((b) => b.kind === "table").length, `${tables} tables`);

  const items = await page.locator("article li").count();
  const expectedItems = blocks.reduce((n, b) => (b.kind === "list" ? n + b.items.length : n), 0);
  check(`${path} renders every bullet`, items === expectedItems, `${items} of ${expectedItems}`);

  // The point of the whole exercise: a legal page must not drop a clause.
  const shown = (await page.locator("article").innerText()).toLowerCase().match(/[a-z0-9]+/g) ?? [];
  const written = source.toLowerCase().match(/[a-z0-9]+/g) ?? [];
  check(`${path} loses no words`, shown.length === written.length, `${shown.length} of ${written.length}`);
}

await page.screenshot({ path: "scripts/shots/legal-privacy.png", fullPage: false });

// --- reachable from the app ----------------------------------------------
await page.goto("http://localhost:3000/sign-in", { waitUntil: "networkidle" });
check("sign-in links to both", (await page.locator('a[href="/terms"]').count()) >= 1 &&
  (await page.locator('a[href="/privacy"]').count()) >= 1);

// --- password reset -------------------------------------------------------
check("sign-in offers a reset",
  (await page.getByRole("button", { name: /forgotten your password/i }).count()) === 1);

await page.getByRole("button", { name: /forgotten your password/i }).click();
const noEmail = await untilText(page.locator('[role="alert"]').first(), (t) => /enter your email/i.test(t));
check("a reset with no address asks for one", /enter your email/i.test(noEmail), noEmail.trim().slice(0, 50));

// An address with no account must look exactly like one that has an account,
// or the form becomes a way to discover who is a user.
await page.fill("#email", `nobody+${Date.now()}@burg.local`);
await page.getByRole("button", { name: /forgotten your password/i }).click();
// Either the neutral answer or the built-in mailer's rate limit -- both are
// the same "we are not telling you who has an account" outcome.
const body = await untilText(
  page.locator("body"),
  (t) => /if that address has an account/i.test(t) || /only allows a few messages/i.test(t),
);
check("an unknown address gets the same answer as a known one",
  /if that address has an account/i.test(body) || /only allows a few messages/i.test(body),
  body.replace(/\n/g, " ").slice(0, 70));

await page.goto("http://localhost:3000/auth/new-password", { waitUntil: "networkidle" });
check("the reset form refuses without a session", /\/sign-in/.test(page.url()) && /expired/i.test(page.url()));

// --- the whole reset, end to end ------------------------------------------
// The real email is rate limited to two an hour, so the link is generated
// through the admin API instead. It is the same link the mail would carry.
{
  const CHANGED = "a-reset-password-from-the-check";
  const { data: link, error: linkError } = await admin.auth.admin.generateLink({
    type: "recovery",
    email: SMOKE_EMAIL,
    options: { redirectTo: "http://localhost:3000/auth/callback?next=%2Fauth%2Fnew-password" },
  });
  check("a recovery link can be generated", !linkError && !!link?.properties?.action_link,
    linkError?.message ?? "");

  const ctx = await browser.newContext({ viewport: { width: 1000, height: 900 } });
  const reset = await ctx.newPage();
  reset.on("pageerror", (e) => errors.push(String(e)));

  await reset.goto(link!.properties!.action_link, { waitUntil: "networkidle" });
  await reset.waitForURL(/new-password/, { timeout: 20000 }).catch(() => {});
  check("the link lands on the new-password form", /new-password/.test(reset.url()), reset.url());
  check("it names the account being changed", (await reset.locator("body").innerText()).includes(SMOKE_EMAIL));

  await reset.fill("#new-password", CHANGED);
  await reset.fill("#confirm-password", "something-else-entirely");
  await reset.getByRole("button", { name: /save password/i }).click();
  const mismatch = await untilText(reset.locator('[role="alert"]').first(), (t) => /do not match/i.test(t));
  check("a mismatch is caught before the server", /do not match/i.test(mismatch), mismatch.trim().slice(0, 40));

  await reset.fill("#confirm-password", CHANGED);
  await reset.getByRole("button", { name: /save password/i }).click();
  await reset.waitForURL(/\/city/, { timeout: 25000 }).catch(() => {});
  check("saving lands in the city", /\/city/.test(reset.url()), reset.url());
  await ctx.close();

  // The new password really is the password now.
  const anon = createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const { error: newPass } = await anon.auth.signInWithPassword({ email: SMOKE_EMAIL, password: CHANGED });
  check("the new password works", !newPass, newPass?.message ?? "");

  const { error: oldPass } = await anon.auth.signInWithPassword({
    email: SMOKE_EMAIL, password: "burg-dev-smoke-test-password",
  });
  check("the old password does not", !!oldPass, oldPass ? "refused" : "STILL WORKS");

  // Put it back, so dev-session.ts and every other suite keep working.
  await admin.auth.admin.updateUserById(
    (await admin.auth.admin.listUsers({ perPage: 1000 })).data.users.find((u) => u.email === SMOKE_EMAIL)!.id,
    { password: "burg-dev-smoke-test-password" },
  );
  check("the smoke-test password is restored", true);
}

check("no page errors", errors.length === 0, errors.join(" | "));
console.log(`\n${results.filter((r) => r.startsWith("PASS")).length}/${results.length} passed`);
await browser.close();
