/**
 * Dev helper: delete every city in the dev database so the seed can be re-run
 * clean.
 *
 *   npx tsx scripts/dev-reset.ts
 *
 * Unscoped on purpose, and safe to be: it can only reach the dev server's
 * database (see local-db.ts), which `npm run check` reseeds and wrecks on
 * every run anyway. The desktop app's database is in a different directory and
 * is never served this way.
 */
import { admin } from "./local-db";

const { data: cities, error } = await admin.from("cities").select("id, name, slug");
if (error) {
  console.error("select failed (is npm run dev up?):", error.message);
  process.exit(1);
}
console.log("deleting every city in the dev database:", cities);

for (const c of cities ?? []) {
  const { error: delError } = await admin.from("cities").delete().eq("id", c.id);
  console.log("delete", c.id, delError ? `FAILED: ${delError.message}` : "ok");
}

const { data: after } = await admin.from("cities").select("id");
console.log(`${(after ?? []).length} cities remain`);
