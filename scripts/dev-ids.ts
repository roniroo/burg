/**
 * Dev helper: print the smoke-test city's building ids by artifact type.
 *
 *   npx tsx scripts/dev-ids.ts [email]     # defaults to seedtest@burg.local
 *
 * Scoped to one account. check-all.sh feeds this straight into the interior
 * suites, which then write to whatever id comes back -- unscoped, a real
 * city's building with the same seeded title would be edited by a test run.
 */
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "../lib/database.types";
import { smokeCity } from "./smoke-city";

config({ path: ".env.local", quiet: true });

const admin = createClient<Database>(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false, autoRefreshToken: false } },
);

const city = await smokeCity(admin, process.argv.find((a) => a.includes("@")));

const { data } = await admin
  .from("buildings")
  .select("id, title, artifact_type")
  .eq("city_id", city.id)
  .order("artifact_type");

for (const b of data ?? []) console.log(`${b.artifact_type}\t${b.id}\t${b.title}`);
