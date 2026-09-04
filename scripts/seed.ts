/**
 * CLI seeder: `npm run seed -- <email> [--create]`
 *
 * Seeds the demo city for a user. Requires SUPABASE_SERVICE_ROLE_KEY because it
 * writes on someone else's behalf; the app's own first-sign-in path does not.
 * Idempotent -- re-running is a no-op once the city exists.
 *
 * `--create` makes the user first if they do not exist, with a confirmed email
 * and a random password. Convenient against a local stack; on a real project
 * prefer signing in once and letting the app seed itself.
 */
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "../lib/database.types";
import { seedIdeaburg } from "../lib/seed/ideaburg";

config({ path: ".env.local", quiet: true });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceKey) {
  console.error(
    "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local.\n" +
      "Find the service role key at:\n" +
      "  https://supabase.com/dashboard/project/ybquniffzetaylkrkadz/settings/api-keys",
  );
  process.exit(1);
}

const email = process.argv[2];
const shouldCreate = process.argv.includes("--create");
if (!email || email.startsWith("--")) {
  console.error("Usage: npm run seed -- <email> [--create]");
  process.exit(1);
}

const admin = createClient<Database>(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const { data, error } = await admin.auth.admin.listUsers({ perPage: 1000 });
if (error) {
  console.error("Could not list users:", error.message);
  process.exit(1);
}

let user = data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());

if (!user && shouldCreate) {
  const created = await admin.auth.admin.createUser({
    email,
    password: crypto.randomUUID(),
    email_confirm: true,
    user_metadata: { full_name: email.split("@")[0] },
  });
  if (created.error) {
    console.error("Could not create user:", created.error.message);
    process.exit(1);
  }
  user = created.data.user;
  console.log(`Created ${email}.`);
}

if (!user) {
  console.error(
    `No user found with email ${email}.\n` +
      "Sign in once at http://localhost:3000, or re-run with --create.",
  );
  process.exit(1);
}

const result = await seedIdeaburg(admin, user.id);
console.log(
  result.created
    ? `Seeded Ideaburg (${result.cityId}) for ${email}.`
    : `${email} already has Ideaburg (${result.cityId}); nothing to do.`,
);
