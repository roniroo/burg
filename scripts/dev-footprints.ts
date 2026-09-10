/**
 * Dev helper: compare every building's stored footprint against the footprint
 * its sprite recipe is drawn for.
 *
 *   npx tsx scripts/dev-footprints.ts          # report
 *   npx tsx scripts/dev-footprints.ts --fix    # write the recipe's shape back
 *
 * A mismatch is not cosmetic: the sprite is drawn to the stored footprint, so
 * a recipe designed for 2x3 rendered on a 1x1 lot has its facade squeezed onto
 * the short side, and `depthFor()` sorts it against its neighbours using the
 * stored size. --fix moves rows onto the recipe's shape, skipping any that
 * would then overlap something or leave their district.
 */
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "../lib/database.types";
import { spriteFootprint, type SpriteKey, type SpriteVariant } from "../lib/sprites";
import { canPlace, type Footprint, type Terrain } from "../lib/placement";

config({ path: ".env.local", quiet: true });

const admin = createClient<Database>(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false, autoRefreshToken: false } },
);

const fix = process.argv.includes("--fix");

const { data: cities } = await admin.from("cities").select("id, name, width, height");
for (const city of cities ?? []) {
  const [{ data: buildings }, { data: hoods }, { data: tiles }] = await Promise.all([
    admin.from("buildings").select("*").eq("city_id", city.id).order("position"),
    admin.from("neighborhoods").select("*").eq("city_id", city.id),
    admin.from("tiles").select("x, y, terrain").eq("city_id", city.id),
  ]);
  const terrain = new Map((tiles ?? []).map((t) => [`${t.x},${t.y}`, t.terrain as Terrain]));
  const terrainAt = (x: number, y: number): Terrain => terrain.get(`${x},${y}`) ?? "grass";

  console.log(`\n${city.name} (${(buildings ?? []).length} buildings)`);

  for (const b of buildings ?? []) {
    const want = spriteFootprint(b.sprite_key as SpriteKey, b.sprite_variant as SpriteVariant);
    const same = b.footprint_w === want.w && b.footprint_h === want.h && b.floors === want.floors;
    if (same) continue;

    const hood = (hoods ?? []).find((n) => n.id === b.neighborhood_id);
    const proposed: Footprint = { tile_x: b.tile_x, tile_y: b.tile_y, footprint_w: want.w, footprint_h: want.h };
    const verdict = hood
      ? canPlace({
          footprint: proposed,
          region: hood,
          occupied: (buildings ?? [])
            .filter((o) => o.id !== b.id)
            .map((o) => ({ tile_x: o.tile_x, tile_y: o.tile_y, footprint_w: o.footprint_w, footprint_h: o.footprint_h })),
          terrainAt,
          city,
        })
      : { ok: false as const, reason: "outside-region" as const };

    const label = `${b.sprite_key}:${b.sprite_variant} ${b.title}`;
    const shape = `${b.footprint_w}x${b.footprint_h} f${b.floors} -> ${want.w}x${want.h} f${want.floors}`;

    if (!verdict.ok) {
      console.log(`  SKIP  ${label}  ${shape}  (${verdict.reason})`);
      continue;
    }
    if (!fix) {
      console.log(`  would fix  ${label}  ${shape}`);
      continue;
    }
    const { error } = await admin
      .from("buildings")
      .update({ footprint_w: want.w, footprint_h: want.h, floors: want.floors })
      .eq("id", b.id);
    console.log(`  ${error ? `FAILED ${error.message}` : "fixed"}  ${label}  ${shape}`);
    if (!error) {
      b.footprint_w = want.w;
      b.footprint_h = want.h;
      b.floors = want.floors;
    }
  }
}
