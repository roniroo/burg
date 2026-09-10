/**
 * Dev helper: delete one user's demo city so the seed can be re-run clean.
 *
 *   npx tsx scripts/dev-reset.ts [email]     # defaults to seedtest@burg.local
 *
 * Scoped to a single account on purpose. The hosted project holds real cities
 * alongside the smoke-test one, and this script is called by `npm run check`;
 * an unscoped delete here would take a real city with it. Pass `--all` only if
 * you genuinely mean every city on the project.
 */
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "../lib/database.types";

config({ path: ".env.local", quiet: true });

const admin = createClient<Database>(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false, autoRefreshToken: false } },
);

const all = process.argv.includes("--all");
const email = process.argv.find((a) => a.includes("@")) ?? "seedtest@burg.local";

let ownerId: string | null = null;
if (!all) {
  const { data: users } = await admin.auth.admin.listUsers({ perPage: 1000 });
  const owner = users.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
  if (!owner) {
    console.error(`no user ${email}; nothing to reset`);
    process.exit(1);
  }
  ownerId = owner.id;
}

const query = admin.from("cities").select("id, name, slug, owner_id");
const { data: cities, error } = await (ownerId ? query.eq("owner_id", ownerId) : query);
if (error) {
  console.error("select failed:", error.message);
  process.exit(1);
}
console.log(all ? "deleting every city:" : `deleting cities owned by ${email}:`, cities);

for (const c of cities ?? []) {
  const { error: delError } = await admin.from("cities").delete().eq("id", c.id);
  console.log("delete", c.id, delError ? `FAILED: ${delError.message}` : "ok");
}

const { data: after } = await admin.from("cities").select("id, owner_id");
console.log(`${(after ?? []).length} cities remain on the project`);
