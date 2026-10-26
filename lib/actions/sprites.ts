"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient, database } from "@/lib/db/server";
import { insertSprite } from "@/lib/db/sprites";
import {
  MAX_FOOTPRINT,
  MAX_SPRITE_BYTES,
  MAX_SPRITE_SIDE,
  parseHitArea,
  pngSize,
} from "@/lib/custom-sprites";
import type { ActionResult } from "@/lib/actions/city";

/**
 * The sprite library: upload and delete. Putting a sprite on a building is a
 * city-shaping act -- it can change the building's footprint -- so it lives
 * with the placement rules in lib/actions/city.ts.
 */

const uploadFields = z.object({
  name: z.string().trim().min(1, "Give it a name.").max(80, "Keep the name under 80 characters."),
  footprintW: z.coerce.number().int().min(1).max(MAX_FOOTPRINT),
  footprintH: z.coerce.number().int().min(1).max(MAX_FOOTPRINT),
  hitArea: z.string().min(1),
});

/**
 * The browser measures the image and traces its outline (it has a canvas and
 * the server does not); the server checks the bytes really are a PNG of the
 * size the browser said, and that the outline fits inside it.
 */
export async function uploadSprite(form: FormData): Promise<ActionResult<{ id: string }>> {
  const file = form.get("image");
  if (!(file instanceof File) || file.size === 0) return { ok: false, error: "Choose a PNG to upload." };
  if (file.size > MAX_SPRITE_BYTES) return { ok: false, error: "That image is over 5 MB." };

  const parsed = uploadFields.safeParse({
    name: form.get("name"),
    footprintW: form.get("footprintW"),
    footprintH: form.get("footprintH"),
    hitArea: form.get("hitArea"),
  });
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Check those details." };

  const image = new Uint8Array(await file.arrayBuffer());
  const size = pngSize(image);
  if (!size) return { ok: false, error: "That is not a PNG. Export it as a PNG with transparency and try again." };
  if (size.width > MAX_SPRITE_SIDE || size.height > MAX_SPRITE_SIDE) {
    return { ok: false, error: `Keep it within ${MAX_SPRITE_SIDE} pixels on each side.` };
  }

  const hitArea = parseHitArea(parsed.data.hitArea, size.width, size.height);
  if (!hitArea) return { ok: false, error: "Nothing in that image is solid enough to click on." };

  const id = await insertSprite(await database(), {
    name: parsed.data.name,
    image,
    width: size.width,
    height: size.height,
    footprintW: parsed.data.footprintW,
    footprintH: parsed.data.footprintH,
    hitArea,
  });

  revalidatePath("/sprites");
  return { ok: true, data: { id } };
}

const deleteSchema = z.object({ spriteId: z.uuid() });

/**
 * Remove a sprite from the library. Buildings wearing it go back to their
 * usual look -- `on delete set null` -- keeping the footprint they had.
 */
export async function deleteSprite(input: unknown): Promise<ActionResult> {
  const parsed = deleteSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid sprite." };

  const supabase = await createClient();
  const { error } = await supabase.from("custom_sprites").delete().eq("id", parsed.data.spriteId);
  if (error) return { ok: false, error: error.message };

  // Any building, in any city, may have been wearing it.
  revalidatePath("/", "layout");
  return { ok: true };
}
