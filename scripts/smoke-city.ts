/**
 * Shared by the browser check suites: which city may they touch?
 *
 * Not a runnable script -- a module the check-*.ts scripts import.
 *
 * The hosted project holds real cities alongside the smoke-test one, and an
 * unscoped `admin.from(...)` reaches all of them: `.eq("slug", "harbor-district")
 * .single()` matches two rows and throws, and a bare `count` totals someone
 * else's buildings into the assertion. Every suite resolves its city through
 * here and filters by the id it returns.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../lib/database.types";

export const SMOKE_EMAIL = "seedtest@burg.local";

export type SmokeCity = { id: string; name: string; width: number; height: number };

export async function smokeCity(
  admin: SupabaseClient<Database>,
  email = SMOKE_EMAIL,
): Promise<SmokeCity> {
  const { data: users } = await admin.auth.admin.listUsers({ perPage: 1000 });
  const owner = users.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
  if (!owner) throw new Error(`no user ${email}; run: npm run seed -- ${email} --create`);

  const { data: city } = await admin
    .from("cities")
    .select("id, name, width, height")
    .eq("owner_id", owner.id)
    .order("created_at")
    .limit(1)
    .maybeSingle();
  if (!city) throw new Error(`${email} has no city; run: npm run seed -- ${email}`);

  return city;
}
