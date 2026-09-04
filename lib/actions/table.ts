"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { cellToText, coerceCell, type Field, type FieldOptions } from "@/lib/table/model";
import type { Json, TablesUpdate } from "@/lib/database.types";

/**
 * Warehouse actions.
 *
 * Rows are jsonb keyed by field id, so nothing here is a migration. Two
 * invariants are maintained on write:
 *   - `table_rows.search_text` mirrors the primary field, so rows are findable
 *     without the search function needing to know each table's schema.
 *   - a `relation` cell keeps a `building_links` row between the two
 *     warehouses, which is what draws a road between them.
 */

export type ActionResult<T = undefined> =
  | ({ ok: true } & (T extends undefined ? object : { data: T }))
  | { ok: false; error: string };

const cellValue = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.array(z.string()),
  z.null(),
]);

async function loadSchema(buildingId: string) {
  const supabase = await createClient();
  const [{ data: table }, { data: fields }] = await Promise.all([
    supabase.from("data_tables").select("building_id, city_id, primary_field_id").eq("building_id", buildingId).maybeSingle(),
    supabase.from("table_fields").select("*").eq("building_id", buildingId).order("position"),
  ]);
  return {
    supabase,
    table,
    fields: (fields ?? []).map((f) => ({
      id: f.id,
      name: f.name,
      field_type: f.field_type,
      options: (f.options ?? {}) as FieldOptions,
      position: f.position,
      width: f.width,
    })) satisfies Field[],
  };
}

/**
 * Keep `building_links` in step with a relation cell.
 *
 * The link is between the two warehouses, not the two rows: roads connect
 * buildings, and a per-row road would be unreadable at city zoom.
 */
async function syncRelationLink(
  supabase: Awaited<ReturnType<typeof createClient>>,
  cityId: string,
  sourceBuildingId: string,
  targetBuildingId: string | undefined,
  hasValue: boolean,
) {
  if (!targetBuildingId || targetBuildingId === sourceBuildingId) return;

  if (hasValue) {
    await supabase
      .from("building_links")
      .upsert(
        {
          city_id: cityId,
          source_building_id: sourceBuildingId,
          target_building_id: targetBuildingId,
          link_type: "relation" as const,
        },
        { onConflict: "source_building_id,target_building_id,link_type", ignoreDuplicates: true },
      );
    return;
  }

  // Only drop the link once no row in this table still points at that table.
  const { data: remaining } = await supabase
    .from("table_rows")
    .select("id")
    .eq("building_id", sourceBuildingId)
    .limit(1000);

  const stillLinked = (remaining ?? []).length > 0;
  if (!stillLinked) {
    await supabase
      .from("building_links")
      .delete()
      .eq("source_building_id", sourceBuildingId)
      .eq("target_building_id", targetBuildingId)
      .eq("link_type", "relation");
  }
}

const updateCellSchema = z.object({
  buildingId: z.uuid(),
  rowId: z.uuid(),
  fieldId: z.uuid(),
  value: cellValue,
});

export async function updateCell(input: unknown): Promise<ActionResult> {
  const parsed = updateCellSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid cell." };

  const { buildingId, rowId, fieldId, value } = parsed.data;
  const { supabase, table, fields } = await loadSchema(buildingId);
  if (!table) return { ok: false, error: "That warehouse no longer exists." };

  const field = fields.find((f) => f.id === fieldId);
  if (!field) return { ok: false, error: "That column no longer exists." };

  const { data: row } = await supabase.from("table_rows").select("data").eq("id", rowId).maybeSingle();
  if (!row) return { ok: false, error: "That row no longer exists." };

  const coerced = coerceCell(field.field_type, value);
  const data = { ...((row.data ?? {}) as Record<string, unknown>), [fieldId]: coerced };

  const patch: { data: Json; search_text?: string } = { data: data as Json };
  if (table.primary_field_id === fieldId) {
    patch.search_text = cellToText(field, coerced);
  }

  const { error } = await supabase.from("table_rows").update(patch).eq("id", rowId);
  if (error) return { ok: false, error: error.message };

  if (field.field_type === "relation") {
    await syncRelationLink(
      supabase,
      table.city_id,
      buildingId,
      field.options.targetBuildingId,
      Array.isArray(coerced) && coerced.length > 0,
    );
  }

  revalidatePath(`/b/${buildingId}`);
  return { ok: true };
}

const addRowSchema = z.object({ buildingId: z.uuid() });

export async function addRow(input: unknown): Promise<ActionResult<{ id: string }>> {
  const parsed = addRowSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid table." };

  const { supabase, table } = await loadSchema(parsed.data.buildingId);
  if (!table) return { ok: false, error: "That warehouse no longer exists." };

  const { data: last } = await supabase
    .from("table_rows")
    .select("position")
    .eq("building_id", parsed.data.buildingId)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();

  const id = crypto.randomUUID();
  const { error } = await supabase.from("table_rows").insert({
    id,
    city_id: table.city_id,
    building_id: parsed.data.buildingId,
    data: {} as Json,
    search_text: "",
    position: (last?.position ?? -1) + 1,
  });

  if (error) return { ok: false, error: error.message };
  revalidatePath(`/b/${parsed.data.buildingId}`);
  return { ok: true, data: { id } };
}

const deleteRowSchema = z.object({ buildingId: z.uuid(), rowId: z.uuid() });

export async function deleteRow(input: unknown): Promise<ActionResult> {
  const parsed = deleteRowSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid row." };

  const supabase = await createClient();
  const { error } = await supabase.from("table_rows").delete().eq("id", parsed.data.rowId);
  if (error) return { ok: false, error: error.message };

  revalidatePath(`/b/${parsed.data.buildingId}`);
  return { ok: true };
}

const addFieldSchema = z.object({
  buildingId: z.uuid(),
  name: z.string().trim().min(1, "A column needs a name.").max(80),
  fieldType: z.enum([
    "text", "long_text", "number", "currency", "select", "multi_select",
    "date", "checkbox", "url", "person", "relation",
  ]),
});

export async function addField(input: unknown): Promise<ActionResult> {
  const parsed = addFieldSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid column." };

  const { supabase, table, fields } = await loadSchema(parsed.data.buildingId);
  if (!table) return { ok: false, error: "That warehouse no longer exists." };

  const { error } = await supabase.from("table_fields").insert({
    city_id: table.city_id,
    building_id: parsed.data.buildingId,
    name: parsed.data.name,
    field_type: parsed.data.fieldType,
    options: {} as Json,
    position: fields.length,
    width: 180,
  });

  if (error) return { ok: false, error: error.message };
  revalidatePath(`/b/${parsed.data.buildingId}`);
  return { ok: true };
}

const updateFieldSchema = z.object({
  buildingId: z.uuid(),
  fieldId: z.uuid(),
  name: z.string().trim().min(1).max(80).optional(),
  width: z.number().int().min(48).max(1200).optional(),
  position: z.number().int().min(0).optional(),
});

export async function updateField(input: unknown): Promise<ActionResult> {
  const parsed = updateFieldSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid column change." };

  const { buildingId, fieldId, ...patch } = parsed.data;
  const supabase = await createClient();
  const { error } = await supabase.from("table_fields").update(patch).eq("id", fieldId);
  if (error) return { ok: false, error: error.message };

  revalidatePath(`/b/${buildingId}`);
  return { ok: true };
}

const deleteFieldSchema = z.object({ buildingId: z.uuid(), fieldId: z.uuid() });

export async function deleteField(input: unknown): Promise<ActionResult> {
  const parsed = deleteFieldSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid column." };

  const { supabase, table } = await loadSchema(parsed.data.buildingId);
  if (table?.primary_field_id === parsed.data.fieldId) {
    return { ok: false, error: "The primary column cannot be removed." };
  }

  const { error } = await supabase.from("table_fields").delete().eq("id", parsed.data.fieldId);
  if (error) return { ok: false, error: error.message };

  revalidatePath(`/b/${parsed.data.buildingId}`);
  return { ok: true };
}

const reorderFieldsSchema = z.object({
  buildingId: z.uuid(),
  orderedIds: z.array(z.uuid()).max(200),
});

export async function reorderFields(input: unknown): Promise<ActionResult> {
  const parsed = reorderFieldsSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid order." };

  const supabase = await createClient();
  for (const [index, id] of parsed.data.orderedIds.entries()) {
    const { error } = await supabase.from("table_fields").update({ position: index }).eq("id", id);
    if (error) return { ok: false, error: error.message };
  }

  revalidatePath(`/b/${parsed.data.buildingId}`);
  return { ok: true };
}

const updateViewSchema = z.object({
  buildingId: z.uuid(),
  viewId: z.uuid(),
  name: z.string().trim().min(1).max(80).optional(),
  filters: z.array(z.looseObject({ fieldId: z.string(), op: z.string() })).optional(),
  sorts: z.array(z.looseObject({ fieldId: z.string(), direction: z.enum(["asc", "desc"]) })).optional(),
  hiddenFields: z.array(z.uuid()).optional(),
  groupByFieldId: z.uuid().nullable().optional(),
});

export async function updateView(input: unknown): Promise<ActionResult> {
  const parsed = updateViewSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Invalid view." };

  const { buildingId, viewId, hiddenFields, groupByFieldId, ...rest } = parsed.data;
  const supabase = await createClient();

  const patch: TablesUpdate<"table_views"> = {};
  if (rest.name !== undefined) patch.name = rest.name;
  if (rest.filters !== undefined) patch.filters = rest.filters as Json;
  if (rest.sorts !== undefined) patch.sorts = rest.sorts as Json;
  if (hiddenFields !== undefined) patch.hidden_fields = hiddenFields as Json;
  if (groupByFieldId !== undefined) patch.group_by_field_id = groupByFieldId;

  const { error } = await supabase.from("table_views").update(patch).eq("id", viewId);
  if (error) return { ok: false, error: error.message };

  revalidatePath(`/b/${buildingId}`);
  return { ok: true };
}

/** Bulk cell write, used by paste. One round trip per affected row. */
const pasteSchema = z.object({
  buildingId: z.uuid(),
  cells: z
    .array(z.object({ rowId: z.uuid(), fieldId: z.uuid(), value: cellValue }))
    .max(2000),
});

export async function pasteCells(input: unknown): Promise<ActionResult> {
  const parsed = pasteSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Nothing pasteable." };

  const { buildingId, cells } = parsed.data;
  const { supabase, table, fields } = await loadSchema(buildingId);
  if (!table) return { ok: false, error: "That warehouse no longer exists." };

  const fieldById = new Map(fields.map((f) => [f.id, f]));
  const byRow = new Map<string, typeof cells>();
  for (const cell of cells) {
    byRow.set(cell.rowId, [...(byRow.get(cell.rowId) ?? []), cell]);
  }

  const { data: rows } = await supabase
    .from("table_rows")
    .select("id, data")
    .in("id", [...byRow.keys()]);

  for (const row of rows ?? []) {
    const data = { ...((row.data ?? {}) as Record<string, unknown>) };
    let searchText: string | undefined;

    for (const cell of byRow.get(row.id) ?? []) {
      const field = fieldById.get(cell.fieldId);
      if (!field) continue;
      const coerced = coerceCell(field.field_type, cell.value);
      data[cell.fieldId] = coerced;
      if (table.primary_field_id === cell.fieldId) searchText = cellToText(field, coerced);
    }

    const patch: { data: Json; search_text?: string } = { data: data as Json };
    if (searchText !== undefined) patch.search_text = searchText;

    const { error } = await supabase.from("table_rows").update(patch).eq("id", row.id);
    if (error) return { ok: false, error: error.message };
  }

  revalidatePath(`/b/${buildingId}`);
  return { ok: true };
}
