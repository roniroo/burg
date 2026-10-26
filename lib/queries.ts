import { cookies } from "next/headers";
import { createClient, getOwner } from "@/lib/db/server";
import type { Database } from "@/lib/database.types";
import type { CustomSpriteMeta } from "@/lib/custom-sprites";

/** Which of the cities you can reach you are currently looking at. */
export const ACTIVE_CITY_COOKIE = "burg-city";

export type City = Database["public"]["Tables"]["cities"]["Row"];
export type Neighborhood = Database["public"]["Tables"]["neighborhoods"]["Row"];
export type Building = Database["public"]["Tables"]["buildings"]["Row"];
export type ArtifactType = Database["public"]["Enums"]["artifact_type"];
export type Biome = Database["public"]["Enums"]["biome"];
export type NeighborhoodStatus = Database["public"]["Enums"]["neighborhood_status"];

export type CityRole = Database["public"]["Enums"]["city_role"];

/**
 * Every city on this machine, with the owner's role in each.
 *
 * On the hosted service RLS narrowed this to the cities you were a member of.
 * Here everything belongs to one person, so it is simply all of them; the role
 * still comes from `city_members`, which is what decides whether the building
 * controls are shown.
 */
export async function getReachableCities(): Promise<Array<City & { role: CityRole }>> {
  const [supabase, owner] = await Promise.all([createClient(), getOwner()]);

  const [{ data: cities }, { data: memberships }] = await Promise.all([
    supabase.from("cities").select("*").order("created_at"),
    supabase.from("city_members").select("city_id, role").eq("user_id", owner.id),
  ]);

  const roleFor = new Map((memberships ?? []).map((m) => [m.city_id, m.role]));
  return (cities ?? []).map((c) => ({ ...c, role: roleFor.get(c.id) ?? ("viewer" as CityRole) }));
}

/**
 * The city being looked at.
 *
 * A cookie remembers the choice, and is validated against what the user can
 * actually reach rather than trusted — losing access to a shared city should
 * drop you back into your own, not into an error. With no cookie, your own
 * city wins over one you were invited to.
 */
export async function getCurrentCity(): Promise<City | null> {
  const reachable = await getReachableCities();
  if (reachable.length === 0) return null;

  const preferred = (await cookies()).get(ACTIVE_CITY_COOKIE)?.value;
  const chosen = preferred ? reachable.find((c) => c.id === preferred) : undefined;
  if (chosen) return chosen;

  return reachable.find((c) => c.role === "owner") ?? reachable[0] ?? null;
}

/** What the owner may do in a city -- always `owner` for a city they founded. */
export async function getCityRole(cityId: string): Promise<CityRole | null> {
  const [supabase, owner] = await Promise.all([createClient(), getOwner()]);

  const { data } = await supabase
    .from("city_members")
    .select("role")
    .eq("city_id", cityId)
    .eq("user_id", owner.id)
    .maybeSingle();
  return data?.role ?? null;
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

// Presentation constants live in lib/artifacts.ts so that client components
// can import them without pulling this server-only module in with them.
export { BUILDING_GLYPH, BUILDING_NOUN } from "@/lib/artifacts";

export type LibrarySprite = CustomSpriteMeta & { uses: number };

/**
 * The sprite library: everything about each sprite except its image, which
 * the map fetches by id, and how many buildings -- in any city -- wear it.
 */
export async function getCustomSprites(): Promise<LibrarySprite[]> {
  const supabase = await createClient();
  const [{ data: sprites }, { data: worn }] = await Promise.all([
    supabase
      .from("custom_sprites")
      .select("id, name, width, height, footprint_w, footprint_h, hit_area")
      .order("created_at"),
    supabase.from("buildings").select("custom_sprite_id").not("custom_sprite_id", "is", null),
  ]);

  const uses = new Map<string, number>();
  for (const b of worn ?? []) {
    if (b.custom_sprite_id) uses.set(b.custom_sprite_id, (uses.get(b.custom_sprite_id) ?? 0) + 1);
  }
  return (sprites ?? []).map((sprite) => ({ ...sprite, uses: uses.get(sprite.id) ?? 0 }));
}
