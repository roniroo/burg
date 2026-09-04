"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { findEmptyLot, type Footprint, type Terrain } from "@/lib/placement";
import type { Json, TablesUpdate } from "@/lib/database.types";

/**
 * Noticeboard actions, including promotion.
 *
 * Promotion is the app's core "idea -> artifact" move: a sticky note becomes a
 * Library, a Warehouse row, or a note on another board. Whatever it becomes,
 * the origin is recorded as a `promoted_from` link, so the thing you built
 * stays visibly connected to the board it came from.
 */

export type ActionResult<T = undefined> =
  | ({ ok: true } & (T extends undefined ? object : { data: T }))
  | { ok: false; error: string };

const addNoteSchema = z.object({
  buildingId: z.uuid(),
  body: z.string().trim().max(2000).default(""),
  color: z.number().int().min(1).max(6).default(1),
  pinX: z.number().int().min(0).max(4000).default(24),
  pinY: z.number().int().min(0).max(4000).default(24),
  rotation: z.number().min(-15).max(15).default(0),
  columnId: z.uuid().nullable().default(null),
});

export async function addNote(input: unknown): Promise<ActionResult<{ id: string }>> {
  const parsed = addNoteSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid note." };

  const { buildingId, body, color, pinX, pinY, rotation, columnId } = parsed.data;
  const supabase = await createClient();

  const { data: board } = await supabase
    .from("boards")
    .select("building_id, city_id")
    .eq("building_id", buildingId)
    .maybeSingle();
  if (!board) return { ok: false, error: "That board no longer exists." };

  const { data: last } = await supabase
    .from("board_notes")
    .select("position")
    .eq("building_id", buildingId)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();

  const id = crypto.randomUUID();
  const { error } = await supabase.from("board_notes").insert({
    id,
    city_id: board.city_id,
    building_id: buildingId,
    column_id: columnId,
    body,
    color,
    pin_x: pinX,
    pin_y: pinY,
    rotation,
    position: (last?.position ?? -1) + 1,
  });

  if (error) return { ok: false, error: error.message };
  revalidatePath(`/b/${buildingId}`);
  return { ok: true, data: { id } };
}

const updateNoteSchema = z.object({
  buildingId: z.uuid(),
  noteId: z.uuid(),
  body: z.string().trim().max(2000).optional(),
  color: z.number().int().min(1).max(6).optional(),
  pinX: z.number().int().min(0).max(4000).optional(),
  pinY: z.number().int().min(0).max(4000).optional(),
  rotation: z.number().min(-15).max(15).optional(),
  columnId: z.uuid().nullable().optional(),
  position: z.number().int().min(0).optional(),
});

export async function updateNote(input: unknown): Promise<ActionResult> {
  const parsed = updateNoteSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid note change." };

  const { buildingId, noteId, pinX, pinY, columnId, ...rest } = parsed.data;
  const supabase = await createClient();

  const patch: TablesUpdate<"board_notes"> = {};
  if (rest.body !== undefined) patch.body = rest.body;
  if (rest.color !== undefined) patch.color = rest.color;
  if (rest.rotation !== undefined) patch.rotation = rest.rotation;
  if (rest.position !== undefined) patch.position = rest.position;
  if (pinX !== undefined) patch.pin_x = pinX;
  if (pinY !== undefined) patch.pin_y = pinY;
  if (columnId !== undefined) patch.column_id = columnId;

  const { error } = await supabase.from("board_notes").update(patch).eq("id", noteId);
  if (error) return { ok: false, error: error.message };

  revalidatePath(`/b/${buildingId}`);
  return { ok: true };
}

const deleteNoteSchema = z.object({ buildingId: z.uuid(), noteId: z.uuid() });

export async function deleteNote(input: unknown): Promise<ActionResult> {
  const parsed = deleteNoteSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid note." };

  const supabase = await createClient();
  const { error } = await supabase.from("board_notes").delete().eq("id", parsed.data.noteId);
  if (error) return { ok: false, error: error.message };

  revalidatePath(`/b/${parsed.data.buildingId}`);
  return { ok: true };
}

const setModeSchema = z.object({ buildingId: z.uuid(), mode: z.enum(["freeform", "columns"]) });

export async function setBoardMode(input: unknown): Promise<ActionResult> {
  const parsed = setModeSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid mode." };

  const supabase = await createClient();
  const { buildingId, mode } = parsed.data;

  const { error } = await supabase.from("boards").update({ mode }).eq("building_id", buildingId);
  if (error) return { ok: false, error: error.message };

  // A board switching to lanes needs at least one lane to drop notes into.
  if (mode === "columns") {
    const { count } = await supabase
      .from("board_columns")
      .select("id", { count: "exact", head: true })
      .eq("building_id", buildingId);

    if ((count ?? 0) === 0) {
      const { data: board } = await supabase
        .from("boards").select("city_id").eq("building_id", buildingId).maybeSingle();
      if (board) {
        await supabase.from("board_columns").insert(
          ["Ideas", "Doing", "Done"].map((name, i) => ({
            city_id: board.city_id,
            building_id: buildingId,
            name,
            color: i + 1,
            position: i,
          })),
        );
      }
    }
  }

  revalidatePath(`/b/${buildingId}`);
  return { ok: true };
}

/* -------------------------------------------------------------------------
   Promotion
   ------------------------------------------------------------------------- */

const promoteSchema = z.object({
  buildingId: z.uuid(),
  noteId: z.uuid(),
  target: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("doc") }),
    z.object({ kind: z.literal("row"), targetBuildingId: z.uuid() }),
    z.object({ kind: z.literal("board"), targetBuildingId: z.uuid() }),
  ]),
});

export type PromoteResult = { buildingId: string; kind: "doc" | "row" | "board"; title: string };

export async function promoteNote(input: unknown): Promise<ActionResult<PromoteResult>> {
  const parsed = promoteSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid promotion." };

  const { buildingId, noteId, target } = parsed.data;
  const supabase = await createClient();

  const { data: note } = await supabase
    .from("board_notes")
    .select("id, body, city_id, building_id")
    .eq("id", noteId)
    .maybeSingle();
  if (!note) return { ok: false, error: "That note is already gone." };

  const title = (note.body.split("\n")[0] ?? "Untitled").trim().slice(0, 120) || "Untitled";

  if (target.kind === "board") {
    const { error } = await supabase
      .from("board_notes")
      .update({ building_id: target.targetBuildingId, column_id: null })
      .eq("id", noteId);
    if (error) return { ok: false, error: error.message };

    await linkPromotion(supabase, note.city_id, buildingId, target.targetBuildingId);
    revalidatePath(`/b/${buildingId}`);
    revalidatePath(`/b/${target.targetBuildingId}`);
    return { ok: true, data: { buildingId: target.targetBuildingId, kind: "board", title } };
  }

  if (target.kind === "row") {
    const { data: table } = await supabase
      .from("data_tables")
      .select("building_id, city_id, primary_field_id")
      .eq("building_id", target.targetBuildingId)
      .maybeSingle();
    if (!table) return { ok: false, error: "That warehouse no longer exists." };

    const { data: last } = await supabase
      .from("table_rows")
      .select("position")
      .eq("building_id", target.targetBuildingId)
      .order("position", { ascending: false })
      .limit(1)
      .maybeSingle();

    const data = table.primary_field_id ? { [table.primary_field_id]: title } : {};

    const { error } = await supabase.from("table_rows").insert({
      city_id: table.city_id,
      building_id: target.targetBuildingId,
      data: data as Json,
      search_text: title,
      position: (last?.position ?? -1) + 1,
    });
    if (error) return { ok: false, error: error.message };

    await supabase.from("board_notes").delete().eq("id", noteId);
    await linkPromotion(supabase, note.city_id, buildingId, target.targetBuildingId);

    revalidatePath(`/b/${buildingId}`);
    revalidatePath(`/b/${target.targetBuildingId}`);
    return { ok: true, data: { buildingId: target.targetBuildingId, kind: "row", title } };
  }

  // --- promote into a new Library ----------------------------------------
  const { data: board } = await supabase
    .from("buildings")
    .select("neighborhood_id, city_id")
    .eq("id", buildingId)
    .maybeSingle();
  if (!board) return { ok: false, error: "That board no longer exists." };

  const [{ data: hood }, { data: city }, { data: siblings }, { data: tiles }] = await Promise.all([
    supabase.from("neighborhoods").select("*").eq("id", board.neighborhood_id).maybeSingle(),
    supabase.from("cities").select("width, height").eq("id", board.city_id).maybeSingle(),
    supabase
      .from("buildings")
      .select("tile_x, tile_y, footprint_w, footprint_h")
      .eq("neighborhood_id", board.neighborhood_id),
    supabase.from("tiles").select("x, y, terrain").eq("city_id", board.city_id),
  ]);

  if (!hood || !city) return { ok: false, error: "That neighbourhood no longer exists." };

  const terrainByKey = new Map((tiles ?? []).map((t) => [`${t.x},${t.y}`, t.terrain as Terrain]));
  const lot = findEmptyLot({
    region: hood,
    occupied: (siblings ?? []) as Footprint[],
    terrainAt: (x, y) => terrainByKey.get(`${x},${y}`) ?? "grass",
    city,
  });

  if (!lot) return { ok: false, error: "This neighbourhood has no empty lots left." };

  const newBuildingId = crypto.randomUUID();
  const { error: buildingError } = await supabase.from("buildings").insert({
    id: newBuildingId,
    city_id: board.city_id,
    neighborhood_id: board.neighborhood_id,
    title,
    artifact_type: "doc",
    sprite_key: "library",
    sprite_variant: 1,
    tile_x: lot.tile_x,
    tile_y: lot.tile_y,
    footprint_w: 1,
    footprint_h: 1,
    floors: 1,
    position: (siblings ?? []).length,
  });
  if (buildingError) return { ok: false, error: buildingError.message };

  const content = {
    type: "doc",
    content: note.body
      .split("\n")
      .filter(Boolean)
      .map((line) => ({ type: "paragraph", content: [{ type: "text", text: line }] })),
  };

  const { error: docError } = await supabase.from("documents").insert({
    building_id: newBuildingId,
    city_id: board.city_id,
    content: content as Json,
    search_text: note.body,
  });
  if (docError) return { ok: false, error: docError.message };

  await supabase.from("board_notes").delete().eq("id", noteId);
  await linkPromotion(supabase, board.city_id, buildingId, newBuildingId);

  await supabase.from("activity").insert({
    city_id: board.city_id,
    verb: "promoted",
    subject_type: "building",
    subject_id: newBuildingId,
    headline: `Notice taken down and built as a library: "${title}"`,
  });

  revalidatePath(`/b/${buildingId}`);
  revalidatePath("/city");
  revalidatePath("/directory");
  return { ok: true, data: { buildingId: newBuildingId, kind: "doc", title } };
}

/** Record where a promoted artifact came from. This is what paves the road. */
async function linkPromotion(
  supabase: Awaited<ReturnType<typeof createClient>>,
  cityId: string,
  sourceBuildingId: string,
  targetBuildingId: string,
) {
  if (sourceBuildingId === targetBuildingId) return;
  await supabase.from("building_links").upsert(
    {
      city_id: cityId,
      source_building_id: sourceBuildingId,
      target_building_id: targetBuildingId,
      link_type: "promoted_from" as const,
    },
    { onConflict: "source_building_id,target_building_id,link_type", ignoreDuplicates: true },
  );
}
