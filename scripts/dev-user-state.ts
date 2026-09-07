import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "../lib/database.types";

config({ path: ".env.local", quiet: true });
const admin = createClient<Database>(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false, autoRefreshToken: false } },
);

const { data } = await admin.auth.admin.listUsers({ perPage: 1000 });
for (const u of data.users) {
  const { count } = await admin
    .from("cities").select("id", { count: "exact", head: true }).eq("owner_id", u.id);
  console.log(
    `${u.email}\n  confirmed: ${u.email_confirmed_at ? "yes" : "NO — cannot sign in"}` +
      `\n  cities: ${count}\n  created: ${u.created_at}`,
  );
}
