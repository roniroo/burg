import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/database.types";
import {
  allowancesFor,
  FREE_PLAN,
  isEntitled,
  type Allowances,
  type Plan,
  type Usage,
} from "@/lib/plan";

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
 * Every city this user can reach — their own, plus any they were invited to.
 *
 * RLS does the filtering: `cities_select` is membership, so this cannot return
 * a city the caller is not a member of.
 */
export async function getReachableCities(): Promise<Array<City & { role: CityRole }>> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return [];

  const [{ data: cities }, { data: memberships }] = await Promise.all([
    supabase.from("cities").select("*").order("created_at"),
    supabase.from("city_members").select("city_id, role").eq("user_id", user.id),
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

/** What the signed-in user may do in a city. */
export async function getCityRole(cityId: string): Promise<CityRole | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data } = await supabase
    .from("city_members")
    .select("role")
    .eq("city_id", cityId)
    .eq("user_id", user.id)
    .maybeSingle();
  return data?.role ?? null;
}

export type CityPerson = {
  userId: string;
  name: string;
  role: CityRole;
  isYou: boolean;
};

export type CityInvite = {
  id: string;
  email: string;
  role: CityRole;
};

/**
 * Who is in a city, and who has been asked.
 *
 * Names come from `profiles`, which co-members can read because of
 * `burg.shares_a_city_with`. A member whose profile row is somehow missing is
 * still listed — a people page that silently omits someone with access would
 * be worse than one showing "Someone".
 */
export async function getCityPeople(
  cityId: string,
): Promise<{ people: CityPerson[]; invites: CityInvite[] }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const [{ data: members }, { data: invites }] = await Promise.all([
    supabase.from("city_members").select("user_id, role").eq("city_id", cityId),
    supabase.from("city_invites").select("id, email, role").eq("city_id", cityId).order("created_at"),
  ]);

  const ids = (members ?? []).map((m) => m.user_id);
  const { data: profiles } = ids.length
    ? await supabase.from("profiles").select("id, display_name").in("id", ids)
    : { data: [] };
  const nameFor = new Map((profiles ?? []).map((p) => [p.id, p.display_name]));

  const people = (members ?? [])
    .map((m) => ({
      userId: m.user_id,
      name: nameFor.get(m.user_id)?.trim() || "Someone",
      role: m.role,
      isYou: m.user_id === user?.id,
    }))
    // Owner first, then editors, then viewers; you are always easy to find.
    .sort((a, b) => {
      const rank = { owner: 0, editor: 1, viewer: 2 } as const;
      return rank[a.role] - rank[b.role] || a.name.localeCompare(b.name);
    });

  return { people, invites: invites ?? [] };
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

/**
 * The plan a city is on, what it has used, and what that leaves.
 *
 * Read through `city_is_paid` rather than from `subscriptions` directly: the
 * plan belongs to the city's *owner*, and a collaborator has no read on
 * somebody else's billing row. The RPC answers the one boolean they are
 * entitled to know and nothing else.
 *
 * Counts are `head: true` counts rather than fetched rows -- the caller wants
 * two numbers, not fifty buildings.
 */
export async function getCityPlan(cityId: string): Promise<{
  paid: boolean;
  usage: Usage;
  allowances: Allowances;
}> {
  const supabase = await createClient();

  const [{ data: paid }, districts, buildings] = await Promise.all([
    supabase.rpc("city_is_paid", { target_city: cityId }),
    supabase.from("neighborhoods").select("*", { count: "exact", head: true }).eq("city_id", cityId),
    supabase.from("buildings").select("*", { count: "exact", head: true }).eq("city_id", cityId),
  ]);

  const usage: Usage = {
    districts: districts.count ?? 0,
    buildings: buildings.count ?? 0,
  };

  return { paid: paid === true, usage, allowances: allowancesFor(paid === true, usage) };
}

/**
 * The signed-in user's own subscription, for the plan page.
 *
 * Only ever their own: `subscriptions_select_own` is the only policy on the
 * table, so this returns nothing for anybody else's row however it is asked.
 */
export async function getMyPlan(): Promise<Plan> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return FREE_PLAN;

  const { data } = await supabase
    .from("subscriptions")
    .select("status, current_period_end, cancel_at_period_end")
    .eq("user_id", user.id)
    .maybeSingle();

  if (!data) return FREE_PLAN;

  return {
    paid: isEntitled(data.status),
    status: data.status,
    currentPeriodEnd: data.current_period_end,
    cancelAtPeriodEnd: data.cancel_at_period_end,
  };
}
