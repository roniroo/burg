/**
 * Dev helper: remove throwaway accounts left by probes and check runs.
 *
 * Only touches @burg.local addresses, which are never real. Deleting a user
 * cascades their city away with them.
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

const KEEP = new Set(["seedtest@burg.local"]);

const { data } = await admin.auth.admin.listUsers({ perPage: 1000 });
for (const user of data.users) {
  const email = user.email ?? "";
  const throwaway = email.endsWith("@burg.local") && !KEEP.has(email);
  console.log(`${throwaway ? "delete" : "keep  "}  ${email}`);
  if (throwaway) await admin.auth.admin.deleteUser(user.id);
}

const { data: after } = await admin.auth.admin.listUsers({ perPage: 1000 });
console.log(`\n${after.users.length} users remain`);
