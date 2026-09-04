"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { parseScene } from "@/lib/canvas/model";
import type { Json } from "@/lib/database.types";

/**
 * Whiteboard save.
 *
 * The scene is one jsonb blob. It is parsed through the same model the editor
 * uses before being stored, so a malformed node cannot be written in and make
 * the board unopenable later.
 */

const schema = z.object({
  buildingId: z.uuid(),
  scene: z.looseObject({}),
});

export type SaveSceneResult = { ok: true } | { ok: false; error: string };

export async function saveScene(input: unknown): Promise<SaveSceneResult> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid scene." };

  const clean = parseScene(parsed.data.scene);

  const supabase = await createClient();
  const { error } = await supabase
    .from("canvases")
    .update({ scene: clean as unknown as Json })
    .eq("building_id", parsed.data.buildingId);

  if (error) return { ok: false, error: error.message };

  revalidatePath(`/b/${parsed.data.buildingId}`);
  return { ok: true };
}
