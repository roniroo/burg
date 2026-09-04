import { createClient } from "@/lib/supabase/server";
import { getCurrentCity } from "@/lib/queries";
import { CityMap } from "@/components/map/city-map";
import type { MapRoute } from "@/components/map/road-layer";
import type { RouteLink } from "@/components/map/connections-panel";
import type { PathTile } from "@/lib/roads";
import type { ArtifactType } from "@/lib/artifacts";

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
  const [{ data: neighborhoods }, { data: buildings }, { data: tiles }, { data: routes }, { data: links }] =
    await Promise.all([
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
      supabase.from("road_routes").select("*").eq("city_id", city.id).order("id"),
      supabase.from("building_links").select("*").eq("city_id", city.id),
    ]);

  const { data: activity } = await supabase
    .from("activity")
    .select("id, headline")
    .eq("city_id", city.id)
    .order("created_at", { ascending: false })
    .limit(12);

  const titleById = new Map((buildings ?? []).map((b) => [b.id, b]));

  // Only routes that have actually been solved can be drawn; the stale ones
  // are counted so the client can kick the solver.
  const solved: MapRoute[] = (routes ?? [])
    .filter((r) => !r.stale && Array.isArray(r.path) && (r.path as PathTile[]).length > 0)
    .map((r) => ({
      id: r.id,
      tier: r.tier,
      scope: r.scope,
      linkCount: r.link_count,
      path: r.path as unknown as PathTile[],
      aBuildingId: r.a_building_id,
      bBuildingId: r.b_building_id,
      aNeighborhoodId: r.a_neighborhood_id,
      bNeighborhoodId: r.b_neighborhood_id,
    }));

  // Every link each route carries, keyed by route id, for the panel.
  const routeLinks: Record<string, RouteLink[]> = {};
  for (const route of solved) {
    const pair = new Set([route.aBuildingId, route.bBuildingId]);
    routeLinks[route.id] = (links ?? [])
      .filter((l) => pair.has(l.source_building_id) && pair.has(l.target_building_id))
      .flatMap((l) => {
        const source = titleById.get(l.source_building_id);
        const target = titleById.get(l.target_building_id);
        if (!source || !target) return [];
        return [
          {
            id: l.id,
            linkType: l.link_type,
            sourceId: source.id,
            sourceTitle: source.title,
            sourceType: source.artifact_type as ArtifactType,
            targetId: target.id,
            targetTitle: target.title,
            targetType: target.artifact_type as ArtifactType,
          },
        ];
      });
  }

  const staleRoutes = (routes ?? []).filter((r) => r.stale || r.link_count === 0).length;

  return (
    <div className="h-full">
      <CityMap
        cityId={city.id}
        cityWidth={city.width}
        cityHeight={city.height}
        neighborhoods={neighborhoods ?? []}
        buildings={buildings ?? []}
        tiles={tiles ?? []}
        routes={solved}
        routeLinks={routeLinks}
        staleRoutes={staleRoutes}
        headlines={(activity ?? []).map((a) => ({ id: a.id, text: a.headline }))}
      />
    </div>
  );
}
