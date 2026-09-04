"use server";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/database.types";

/**
 * City-wide search.
 *
 * One RPC into public.search_all, which unions the indexed surfaces --
 * neighbourhoods, building titles, document bodies, table rows and notes --
 * and runs SECURITY INVOKER, so RLS filters the results without this action
 * having to think about it.
 */

export type SearchKind = Database["public"]["Enums"]["search_kind"];

export type SearchHit = {
  kind: SearchKind;
  id: string;
  buildingId: string | null;
  neighborhoodId: string | null;
  title: string;
  snippet: string;
};

const schema = z.object({
  cityId: z.uuid(),
  query: z.string().trim().min(1).max(200),
});

export async function searchCity(input: unknown): Promise<SearchHit[]> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) return [];

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("search_all", {
    p_city_id: parsed.data.cityId,
    p_query: parsed.data.query,
  });

  // websearch_to_tsquery rejects some punctuation outright; an unparseable
  // query is not an error worth surfacing, it just has no matches.
  if (error) return [];

  return (data ?? []).map((row) => ({
    kind: row.kind,
    id: row.id,
    buildingId: row.building_id,
    neighborhoodId: row.neighborhood_id,
    title: row.title ?? "",
    // ts_headline marks matches with <b>…</b>; the snippet is rendered as
    // text, so the tags would show up literally.
    snippet: (row.snippet ?? "").replace(/<\/?b>/g, ""),
  }));
}
