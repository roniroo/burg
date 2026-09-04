/** Dev helper: create (or find) a throwaway user so the seed can be exercised. */
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "../lib/database.types";

config({ path: ".env.local" });

const admin = createClient<Database>(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false, autoRefreshToken: false } },
);

const email = process.argv[2] ?? "seedtest@burg.local";
const { data: existing } = await admin.auth.admin.listUsers({ perPage: 1000 });
const found = existing.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());

if (found) {
  console.log(`exists: ${email} (${found.id})`);
} else {
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: crypto.randomUUID(),
    email_confirm: true,
    user_metadata: { full_name: "Seed Test" },
  });
  if (error) {
    console.error(error.message);
    process.exit(1);
  }
  console.log(`created: ${email} (${data.user.id})`);
}
