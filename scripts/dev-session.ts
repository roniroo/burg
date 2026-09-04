/**
 * Dev helper: mint a browser-shaped session cookie so the check scripts and
 * screenshot tooling can drive the app as a signed-in user.
 *
 *   npx tsx scripts/dev-session.ts you@example.com
 *
 * Writes /tmp/burg-cookie.txt (override with BURG_COOKIE_FILE). Sets a known
 * password on the account as a side effect, so use a throwaway user.
 */
import { writeFileSync } from "node:fs";
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "../lib/database.types";

config({ path: ".env.local", quiet: true });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const email = process.argv[2] ?? "seedtest@burg.local";
const password = "burg-dev-smoke-test-password";

const admin = createClient<Database>(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const { data: list } = await admin.auth.admin.listUsers({ perPage: 1000 });
const user = list.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
if (!user) {
  console.error(`no user ${email}`);
  process.exit(1);
}
await admin.auth.admin.updateUserById(user.id, { password });

const anon = createClient<Database>(url, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const { data, error } = await anon.auth.signInWithPassword({ email, password });
if (error || !data.session) {
  console.error("sign-in failed:", error?.message);
  process.exit(1);
}

const ref = new URL(url).hostname.split(".")[0];
const base64url = (s: string) =>
  Buffer.from(s, "utf-8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

const value = "base64-" + base64url(JSON.stringify(data.session));
const cookie = `sb-${ref}-auth-token=${value}`;

const out = process.env.BURG_COOKIE_FILE ?? "/tmp/burg-cookie.txt";
writeFileSync(out, cookie);
console.log(`Wrote session cookie for ${email} to ${out}`);
