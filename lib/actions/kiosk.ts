"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { fetchOpenGraph, urlSchema } from "@/lib/og";

/**
 * Newsstand actions.
 *
 * Every action validates its input with Zod at the boundary and relies on RLS
 * for authorisation -- there is no ownership check in application code because
 * the policy already refuses rows outside the caller's city.
 */

const addSchema = z.object({
  buildingId: z.uuid(),
  url: urlSchema,
});

export type ActionResult = { ok: true } | { ok: false; error: string };

export async function addKioskLink(input: unknown): Promise<ActionResult> {
  const parsed = addSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid link." };
  }

  const { buildingId, url } = parsed.data;
  const supabase = await createClient();

  const { data: building } = await supabase
    .from("buildings")
    .select("id, city_id")
    .eq("id", buildingId)
    .maybeSingle();
  if (!building) return { ok: false, error: "That newsstand no longer exists." };

  const { data: last } = await supabase
    .from("kiosk_links")
    .select("position")
    .eq("building_id", buildingId)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();

  const og = await fetchOpenGraph(url);

  const { error } = await supabase.from("kiosk_links").insert({
    city_id: building.city_id,
    building_id: buildingId,
    url,
    title: og.title,
    og_image_url: og.imageUrl,
    note: "",
    storage_path: null,
    position: (last?.position ?? -1) + 1,
  });

  if (error) return { ok: false, error: error.message };

  revalidatePath(`/b/${buildingId}`);
  return { ok: true };
}

const updateSchema = z.object({
  id: z.uuid(),
  buildingId: z.uuid(),
  title: z.string().trim().max(200).optional(),
  note: z.string().trim().max(1000).optional(),
});

export async function updateKioskLink(input: unknown): Promise<ActionResult> {
  const parsed = updateSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid edit." };
  }

  const { id, buildingId, ...fields } = parsed.data;
  const supabase = await createClient();
  const { error } = await supabase.from("kiosk_links").update(fields).eq("id", id);
  if (error) return { ok: false, error: error.message };

  revalidatePath(`/b/${buildingId}`);
  return { ok: true };
}

const deleteSchema = z.object({ id: z.uuid(), buildingId: z.uuid() });

export async function deleteKioskLink(input: unknown): Promise<ActionResult> {
  const parsed = deleteSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid link." };

  const supabase = await createClient();
  const { error } = await supabase.from("kiosk_links").delete().eq("id", parsed.data.id);
  if (error) return { ok: false, error: error.message };

  revalidatePath(`/b/${parsed.data.buildingId}`);
  return { ok: true };
}

const reorderSchema = z.object({
  buildingId: z.uuid(),
  orderedIds: z.array(z.uuid()).max(500),
});

export async function reorderKioskLinks(input: unknown): Promise<ActionResult> {
  const parsed = reorderSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid order." };

  const supabase = await createClient();
  const { buildingId, orderedIds } = parsed.data;

  // Positions are rewritten one row at a time: PostgREST has no multi-row
  // update with differing values, and these lists are short.
  for (const [index, id] of orderedIds.entries()) {
    const { error } = await supabase.from("kiosk_links").update({ position: index }).eq("id", id);
    if (error) return { ok: false, error: error.message };
  }

  revalidatePath(`/b/${buildingId}`);
  return { ok: true };
}
