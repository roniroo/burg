/**
 * Shared by the browser check suites: which city may they touch?
 *
 * Not a runnable script -- a module the check-*.ts scripts import.
 *
 * The suites only ever reach the dev database (see local-db.ts), which belongs
 * to one owner and holds the demo city `npm run seed` makes. Every suite still
 * resolves its city here and filters by the id it returns, so that a second
 * city -- one made by hand while poking at the dev server -- is never counted
 * into an assertion or written to.
 */
import type { Admin } from "./local-db";

export type SmokeCity = { id: string; name: string; width: number; height: number };

export async function smokeCity(admin: Admin): Promise<SmokeCity> {
  const { data: city, error } = await admin
    .from("cities")
    .select("id, name, width, height")
    .eq("slug", "ideaburg")
    .order("created_at")
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`could not read the dev database (is npm run dev up?): ${error.message}`);
  if (!city) throw new Error("the dev database has no Ideaburg; run: npm run seed");

  return city;
}
