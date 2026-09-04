/**
 * CLI seeder: `npm run seed -- <email>`
 *
 * Seeds the demo city for an existing user. Requires SUPABASE_SERVICE_ROLE_KEY
 * because it writes on someone else's behalf; the app's own first-sign-in path
 * does not. Idempotent -- re-running is a no-op once the city exists.
 */
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "../lib/database.types";
import { seedIdeaburg } from "../lib/seed/ideaburg";

config({ path: ".env.local" });

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
if (!email) {
  console.error("Usage: npm run seed -- <email>");
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

const user = data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
if (!user) {
  console.error(`No user found with email ${email}. Sign in once first.`);
  process.exit(1);
}

const result = await seedIdeaburg(admin, user.id);
console.log(
  result.created
    ? `Seeded Ideaburg (${result.cityId}) for ${email}.`
    : `${email} already has Ideaburg (${result.cityId}); nothing to do.`,
);
