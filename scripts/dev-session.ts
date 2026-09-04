/**
 * Dev helper: mint a browser-shaped session cookie for the test user so the
 * authenticated pages can be smoke-tested with curl.
 */
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "../lib/database.types";

config({ path: ".env.local" });

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
console.log(`sb-${ref}-auth-token=${value}`);
