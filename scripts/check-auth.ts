/** Auth: password sign in/up, sign out, and every shape of email link. */
import { chromium, type BrowserContext } from "playwright";
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "../lib/database.types";

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

const EMAIL = "authcheck@burg.local";
const PASSWORD = "burg-check-password-1";

// A confirmed user with a known password, created without sending any email.
const { data: existing } = await admin.auth.admin.listUsers({ perPage: 1000 });
const found = existing.users.find((u) => u.email === EMAIL);
const userId = found
  ? (await admin.auth.admin.updateUserById(found.id, { password: PASSWORD, email_confirm: true })).data.user!.id
  : (await admin.auth.admin.createUser({ email: EMAIL, password: PASSWORD, email_confirm: true })).data.user!.id;

const browser = await chromium.launch();
const errors: string[] = [];
const fresh = async (): Promise<BrowserContext> => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  return ctx;
};

// --- password sign-in ----------------------------------------------------
{
  const ctx = await fresh();
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(String(e)));

  await page.goto("http://localhost:3000/city", { waitUntil: "networkidle" });
  check("an anonymous visit is sent to sign in", /\/sign-in/.test(page.url()), page.url());

  await page.fill("#email", EMAIL);
  await page.fill("#password", "definitely-the-wrong-one");
  await page.getByRole("button", { name: /^sign in$/i }).last().click();
  await page.waitForTimeout(2500);
  // Several elements carry role=alert (the dev overlay adds one), so take
  // the first rather than tripping strict mode.
  const alert = (await page.locator('[role="alert"]').first().innerText().catch(() => "")).trim();
  check("a wrong password is refused with a message", /invalid/i.test(alert), alert.trim().slice(0, 60));

  await page.fill("#password", PASSWORD);
  await page.getByRole("button", { name: /^sign in$/i }).last().click();
  await page.waitForURL(/\/city/, { timeout: 20000 }).catch(() => {});
  check("the right password signs in", /\/city/.test(page.url()), page.url());

  const { count } = await admin
    .from("cities").select("id", { count: "exact", head: true }).eq("owner_id", userId);
  check("signing in seeds a city for a new user", (count ?? 0) === 1, `${count} cities`);

  await page.screenshot({ path: "scripts/shots/auth-signed-in.png" });

  // --- sign out ----------------------------------------------------------
  await page.getByRole("button", { name: /sign out/i }).click();
  await page.waitForURL(/\/sign-in/, { timeout: 15000 }).catch(() => {});
  check("sign out returns to the sign-in page", /\/sign-in/.test(page.url()), page.url());

  await page.goto("http://localhost:3000/city", { waitUntil: "networkidle" });
  check("the session is really gone", /\/sign-in/.test(page.url()), page.url());
  await ctx.close();
}

// --- creating an account -------------------------------------------------
{
  const ctx = await fresh();
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(String(e)));

  const newEmail = `signup+${Date.now()}@burg.local`;
  await page.goto("http://localhost:3000/sign-in", { waitUntil: "networkidle" });
  await page.getByRole("radio", { name: /create account/i }).click();
  await page.fill("#email", newEmail);
  await page.fill("#password", "a-brand-new-password");
  await page.getByRole("button", { name: /^create account$/i }).last().click();
  await page.waitForURL(/\/city/, { timeout: 25000 }).catch(() => {});

  check("creating an account signs straight in, with no email step", /\/city/.test(page.url()), page.url());

  const { data: made } = await admin.auth.admin.listUsers({ perPage: 1000 });
  const created = made.users.find((u) => u.email === newEmail);
  check("the new account is confirmed on the spot", !!created?.email_confirmed_at,
    created?.email_confirmed_at ?? "not confirmed");

  if (created) {
    const { count } = await admin
      .from("cities").select("id", { count: "exact", head: true }).eq("owner_id", created.id);
    check("a new account gets its own city", (count ?? 0) === 1, `${count} cities`);
    await admin.auth.admin.deleteUser(created.id);
  }
  await ctx.close();
}

// --- the link shapes the old callback could not handle -------------------
{
  // An admin-generated magic link uses the implicit flow: tokens in the
  // fragment, which is exactly what used to dead-end on "Missing sign-in code".
  const { data: link } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email: EMAIL,
    options: { redirectTo: "http://localhost:3000/auth/callback" },
  });

  const ctx = await fresh();
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(link!.properties!.action_link, { waitUntil: "networkidle" });
  await page.waitForURL(/\/city/, { timeout: 20000 }).catch(() => {});
  check("a fragment link signs in from a clean browser", /\/city/.test(page.url()), page.url());
  check("the tokens are cleared from the address bar", !page.url().includes("access_token"));
  await ctx.close();
}

{
  // A token_hash link, which is what an email template using {{ .TokenHash }}
  // produces and what works when opened on a different device.
  const { data: link } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email: EMAIL,
    options: { redirectTo: "http://localhost:3000/auth/callback" },
  });
  const hash = link!.properties!.hashed_token;

  const ctx = await fresh();
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(`http://localhost:3000/auth/callback?token_hash=${hash}&type=magiclink`, {
    waitUntil: "networkidle",
  });
  await page.waitForURL(/\/city/, { timeout: 20000 }).catch(() => {});
  check("a token_hash link signs in with no verifier at all", /\/city/.test(page.url()), page.url());
  await ctx.close();
}

// --- a stale PKCE code now explains itself -------------------------------
{
  const ctx = await fresh();
  const page = await ctx.newPage();
  await page.goto("http://localhost:3000/auth/callback?code=not-a-real-code", { waitUntil: "networkidle" });
  const text = await page.locator("body").innerText();
  check("a code with no verifier explains the browser mismatch",
    /different browser|password/i.test(text), text.replace(/\n/g, " ").slice(0, 110));
  await ctx.close();
}

// --- next= is not an open redirect ---------------------------------------
{
  const ctx = await fresh();
  const page = await ctx.newPage();
  await page.goto("http://localhost:3000/sign-in?next=https://example.com/pwned", { waitUntil: "networkidle" });
  await page.fill("#email", EMAIL);
  await page.fill("#password", PASSWORD);
  await page.getByRole("button", { name: /^sign in$/i }).last().click();
  await page.waitForTimeout(3000);
  check("an off-site next= is ignored", !/example\.com/.test(page.url()), page.url());
  await ctx.close();
}

console.log(errors.length ? "\npage errors:\n  " + errors.join("\n  ") : "\nno page errors");
await browser.close();
