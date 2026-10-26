/**
 * Dev helper: print the demo city's building ids by artifact type.
 *
 *   npx tsx scripts/dev-ids.ts
 *
 * Scoped to Ideaburg. check-all.sh feeds this straight into the interior
 * suites, which then write to whatever id comes back -- unscoped, a building
 * with the same seeded title in another city would be edited by a test run.
 */
import { admin } from "./local-db";
import { smokeCity } from "./smoke-city";

const city = await smokeCity(admin);

const { data } = await admin
  .from("buildings")
  .select("id, title, artifact_type")
  .eq("city_id", city.id)
  .order("artifact_type");

for (const b of data ?? []) console.log(`${b.artifact_type}\t${b.id}\t${b.title}`);
