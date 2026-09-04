"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { linkedBuildingIds, plaintextFromDoc } from "@/lib/tiptap/plaintext";
import type { Json } from "@/lib/database.types";

/**
 * Document save.
 *
 * Two things happen here, and the second is the interesting one: the saved
 * content is scanned for `buildingLink` nodes and `building_links` is
 * reconciled to match. Inserting a [[wiki link]] is therefore what causes a
 * road to appear between two buildings on the map -- the trigger on
 * building_links marks the route stale, and Phase 5b's solver paves it.
 */

const saveSchema = z.object({
  buildingId: z.uuid(),
  // The document is arbitrary TipTap JSON; its shape is enforced by the
  // editor's schema, not here. Only the envelope is validated.
  content: z.looseObject({ type: z.literal("doc") }),
});

export type SaveResult =
  | { ok: true; linksAdded: number; linksRemoved: number }
  | { ok: false; error: string };

export async function saveDocument(input: unknown): Promise<SaveResult> {
  const parsed = saveSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid document." };
  }

  const { buildingId, content } = parsed.data;
  const supabase = await createClient();

  const searchText = plaintextFromDoc(content as Json);

  const { error: saveError } = await supabase
    .from("documents")
    .update({ content: content as Json, search_text: searchText })
    .eq("building_id", buildingId);

  if (saveError) return { ok: false, error: saveError.message };

  // --- reconcile the wiki links -------------------------------------------
  const referenced = linkedBuildingIds(content as Json).filter((id) => id !== buildingId);

  // Only link to buildings that actually exist and are visible to this user;
  // RLS makes the second half automatic.
  const { data: valid } = await supabase.from("buildings").select("id").in("id", referenced.length ? referenced : ["00000000-0000-0000-0000-000000000000"]);
  const desired = new Set((valid ?? []).map((b) => b.id));

  const { data: existingRows } = await supabase
    .from("building_links")
    .select("id, target_building_id")
    .eq("source_building_id", buildingId)
    .eq("link_type", "wiki");

  const existing = new Map((existingRows ?? []).map((r) => [r.target_building_id, r.id]));

  const toAdd = [...desired].filter((id) => !existing.has(id));
  const toRemove = [...existing.entries()].filter(([target]) => !desired.has(target));

  if (toRemove.length > 0) {
    const { error } = await supabase
      .from("building_links")
      .delete()
      .in("id", toRemove.map(([, id]) => id));
    if (error) return { ok: false, error: error.message };
  }

  if (toAdd.length > 0) {
    const { data: building } = await supabase
      .from("buildings")
      .select("city_id")
      .eq("id", buildingId)
      .maybeSingle();

    if (building) {
      const { error } = await supabase.from("building_links").insert(
        toAdd.map((target) => ({
          city_id: building.city_id,
          source_building_id: buildingId,
          target_building_id: target,
          link_type: "wiki" as const,
        })),
      );
      if (error) return { ok: false, error: error.message };
    }
  }

  revalidatePath(`/b/${buildingId}`);
  if (toAdd.length || toRemove.length) revalidatePath("/directory");

  return { ok: true, linksAdded: toAdd.length, linksRemoved: toRemove.length };
}

const renameSchema = z.object({
  buildingId: z.uuid(),
  title: z.string().trim().min(1, "A building needs a name.").max(160),
});

export async function renameBuilding(input: unknown): Promise<{ ok: boolean; error?: string }> {
  const parsed = renameSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid name." };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("buildings")
    .update({ title: parsed.data.title })
    .eq("id", parsed.data.buildingId);

  if (error) return { ok: false, error: error.message };

  revalidatePath(`/b/${parsed.data.buildingId}`);
  revalidatePath("/city");
  revalidatePath("/directory");
  return { ok: true };
}
