/** Dev helper: print seeded building ids by artifact type. */
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "../lib/database.types";

config({ path: ".env.local", quiet: true });

const admin = createClient<Database>(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false, autoRefreshToken: false } },
);

const { data } = await admin
  .from("buildings")
  .select("id, title, artifact_type")
  .order("artifact_type");

for (const b of data ?? []) console.log(`${b.artifact_type}\t${b.id}\t${b.title}`);
