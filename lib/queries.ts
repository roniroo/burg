import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/database.types";

export type City = Database["public"]["Tables"]["cities"]["Row"];
export type Neighborhood = Database["public"]["Tables"]["neighborhoods"]["Row"];
export type Building = Database["public"]["Tables"]["buildings"]["Row"];
export type ArtifactType = Database["public"]["Enums"]["artifact_type"];
export type Biome = Database["public"]["Enums"]["biome"];
export type NeighborhoodStatus = Database["public"]["Enums"]["neighborhood_status"];

/** The signed-in user's city. v1 is one city per user. */
export async function getCurrentCity(): Promise<City | null> {
  const supabase = await createClient();
  const { data } = await supabase.from("cities").select("*").order("created_at").limit(1).maybeSingle();
  return data;
}

export type CityTree = {
  city: City;
  neighborhoods: Array<Neighborhood & { buildings: Building[] }>;
};

/** City -> neighbourhood -> building, ordered for display. */
export async function getCityTree(cityId: string): Promise<CityTree | null> {
  const supabase = await createClient();

  const [{ data: city }, { data: neighborhoods }, { data: buildings }] = await Promise.all([
    supabase.from("cities").select("*").eq("id", cityId).maybeSingle(),
    supabase.from("neighborhoods").select("*").eq("city_id", cityId).order("position"),
    supabase.from("buildings").select("*").eq("city_id", cityId).order("position"),
  ]);

  if (!city) return null;

  return {
    city,
    neighborhoods: (neighborhoods ?? []).map((n) => ({
      ...n,
      buildings: (buildings ?? []).filter((b) => b.neighborhood_id === n.id),
    })),
  };
}

export type Connection = {
  id: string;
  linkType: Database["public"]["Enums"]["link_type"];
  source: { id: string; title: string; neighborhood: string };
  target: { id: string; title: string; neighborhood: string };
  crossesNeighborhoods: boolean;
};

/**
 * Every link in the city, flattened for the directory's Connections table.
 * Roads carry real information, so there has to be a plain, sortable,
 * keyboard-navigable version of them.
 */
export async function getConnections(cityId: string): Promise<Connection[]> {
  const supabase = await createClient();

  const [{ data: links }, { data: buildings }, { data: neighborhoods }] = await Promise.all([
    supabase.from("building_links").select("*").eq("city_id", cityId).order("created_at"),
    supabase.from("buildings").select("id, title, neighborhood_id").eq("city_id", cityId),
    supabase.from("neighborhoods").select("id, name").eq("city_id", cityId),
  ]);

  const buildingById = new Map((buildings ?? []).map((b) => [b.id, b]));
  const hoodById = new Map((neighborhoods ?? []).map((n) => [n.id, n.name]));

  return (links ?? []).flatMap((link) => {
    const source = buildingById.get(link.source_building_id);
    const target = buildingById.get(link.target_building_id);
    if (!source || !target) return [];

    return [
      {
        id: link.id,
        linkType: link.link_type,
        source: {
          id: source.id,
          title: source.title,
          neighborhood: hoodById.get(source.neighborhood_id) ?? "—",
        },
        target: {
          id: target.id,
          title: target.title,
          neighborhood: hoodById.get(target.neighborhood_id) ?? "—",
        },
        crossesNeighborhoods: source.neighborhood_id !== target.neighborhood_id,
      },
    ];
  });
}

/** Building type -> the city noun it wears, for labels and accessible names. */
export const BUILDING_NOUN: Record<ArtifactType, string> = {
  doc: "Library",
  table: "Warehouse",
  board: "Noticeboard",
  canvas: "Studio",
  kiosk: "Newsstand",
};

/** Silhouette is not the only signal: every type also carries a glyph. */
export const BUILDING_GLYPH: Record<ArtifactType, string> = {
  doc: "▤",
  table: "▦",
  board: "▣",
  canvas: "◈",
  kiosk: "▥",
};
