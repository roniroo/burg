import { createClient } from "@/lib/supabase/server";
import { getCurrentCity } from "@/lib/queries";
import { CityMap } from "@/components/map/city-map";

export const metadata = { title: "City — Burg" };

/**
 * The city map route. Data is fetched on the server; the map itself is the
 * one large client island, because panning, zooming and picking all need the
 * pointer.
 */
export default async function CityPage() {
  const city = await getCurrentCity();
  if (!city) {
    return (
      <p className="p-8 font-body text-sm text-stone">
        No city yet. Sign out and back in to have one founded for you.
      </p>
    );
  }

  const supabase = await createClient();
  const [{ data: neighborhoods }, { data: buildings }, { data: tiles }] = await Promise.all([
    supabase
      .from("neighborhoods")
      .select("id, name, slug, biome, status, origin_x, origin_y, width, height")
      .eq("city_id", city.id)
      .order("position"),
    supabase
      .from("buildings")
      .select(
        "id, title, artifact_type, sprite_key, sprite_variant, tile_x, tile_y, footprint_w, footprint_h, floors, neighborhood_id",
      )
      .eq("city_id", city.id),
    supabase.from("tiles").select("x, y, terrain, neighborhood_id").eq("city_id", city.id),
  ]);

  return (
    <div className="h-full">
      <CityMap
        cityWidth={city.width}
        cityHeight={city.height}
        neighborhoods={neighborhoods ?? []}
        buildings={buildings ?? []}
        tiles={tiles ?? []}
      />
    </div>
  );
}
