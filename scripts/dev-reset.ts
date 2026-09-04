/** Dev helper: delete the demo city for a user so the seed can be re-run clean. */
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "../lib/database.types";

config({ path: ".env.local", quiet: true });

const admin = createClient<Database>(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false, autoRefreshToken: false } },
);

const { data: cities, error } = await admin.from("cities").select("id, name, slug, owner_id");
if (error) {
  console.error("select failed:", error.message);
  process.exit(1);
}
console.log("cities before:", cities);

for (const c of cities ?? []) {
  const { error: delError } = await admin.from("cities").delete().eq("id", c.id);
  console.log("delete", c.id, delError ? `FAILED: ${delError.message}` : "ok");
}

const { data: after } = await admin.from("cities").select("id");
console.log("cities after:", after);
