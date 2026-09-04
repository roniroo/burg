/**
 * Data-table model: cell coercion, filtering and sorting.
 *
 * Pure and DOM-free, so the grid, the board, the gallery and the server all
 * agree on what a cell means without duplicating the rules. Rows are jsonb
 * keyed by field id, so adding a column is never a migration -- which also
 * means every value arriving here is `unknown` until it is coerced.
 */

import type { Database } from "@/lib/database.types";

export type FieldType = Database["public"]["Enums"]["field_type"];

export type SelectChoice = { id: string; label: string; color: number };

export type FieldOptions = {
  choices?: SelectChoice[];
  /** For `relation`: the warehouse whose rows this field points at. */
  targetBuildingId?: string;
  /** For `currency`: an ISO 4217 code. */
  currency?: string;
};

export type Field = {
  id: string;
  name: string;
  field_type: FieldType;
  options: FieldOptions;
  position: number;
  width: number;
};

export type CellValue = string | number | boolean | string[] | null;
export type RowData = Record<string, CellValue>;

export type Row = {
  id: string;
  data: RowData;
  position: number;
};

/** Types whose value is a list rather than a scalar. */
const MULTI_TYPES = new Set<FieldType>(["multi_select", "relation"]);

export function isMultiValue(type: FieldType): boolean {
  return MULTI_TYPES.has(type);
}

/**
 * Force an arbitrary jsonb value into the shape its field type promises.
 *
 * Returning null for "no value" rather than "" or 0 matters: an empty number
 * cell is not zero, and filters distinguish the two.
 */
export function coerceCell(type: FieldType, raw: unknown): CellValue {
  if (raw === null || raw === undefined) return null;

  switch (type) {
    case "number":
    case "currency": {
      if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
      const parsed = Number(String(raw).replace(/[^0-9.eE+-]/g, ""));
      return Number.isFinite(parsed) && String(raw).trim() !== "" ? parsed : null;
    }
    case "checkbox":
      return typeof raw === "boolean" ? raw : raw === "true" || raw === 1;
    case "multi_select":
    case "relation": {
      if (Array.isArray(raw)) return raw.map(String).filter(Boolean);
      const single = String(raw).trim();
      return single ? [single] : [];
    }
    case "date": {
      const text = String(raw).trim();
      if (!text) return null;
      // Stored as an ISO date string; anything unparseable is kept verbatim
      // rather than silently discarded.
      const time = Date.parse(text);
      return Number.isNaN(time) ? text : new Date(time).toISOString().slice(0, 10);
    }
    default: {
      const text = String(raw);
      return text === "" ? null : text;
    }
  }
}

/** Human-readable form of a cell, used for search text, gallery cards and copy. */
export function cellToText(field: Field, value: CellValue): string {
  if (value === null || value === undefined) return "";

  if (field.field_type === "checkbox") return value ? "Yes" : "No";

  if (isMultiValue(field.field_type) && Array.isArray(value)) {
    if (field.field_type === "multi_select") {
      return value.map((id) => labelForChoice(field, id)).join(", ");
    }
    return value.join(", ");
  }

  if (field.field_type === "select") return labelForChoice(field, String(value));

  if (field.field_type === "currency" && typeof value === "number") {
    const code = field.options.currency ?? "USD";
    try {
      return new Intl.NumberFormat("en", { style: "currency", currency: code }).format(value);
    } catch {
      return String(value);
    }
  }

  return String(value);
}

export function labelForChoice(field: Field, choiceId: string): string {
  return field.options.choices?.find((c) => c.id === choiceId)?.label ?? choiceId;
}

/* -------------------------------------------------------------------------
   Filtering
   ------------------------------------------------------------------------- */

export type FilterOp =
  | "eq"
  | "neq"
  | "contains"
  | "not_contains"
  | "gt"
  | "gte"
  | "lt"
  | "lte"
  | "is_empty"
  | "is_not_empty"
  | "has_any";

export type Filter = { fieldId: string; op: FilterOp; value?: CellValue };

export function isEmpty(value: CellValue): boolean {
  if (value === null || value === undefined) return true;
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === "string") return value.trim() === "";
  return false;
}

export function matchesFilter(field: Field, value: CellValue, filter: Filter): boolean {
  if (filter.op === "is_empty") return isEmpty(value);
  if (filter.op === "is_not_empty") return !isEmpty(value);

  const target = filter.value ?? null;

  if (filter.op === "has_any") {
    const wanted = Array.isArray(target) ? target : target === null ? [] : [String(target)];
    if (wanted.length === 0) return true;
    const held = Array.isArray(value) ? value : value === null ? [] : [String(value)];
    return wanted.some((w) => held.includes(w));
  }

  if (filter.op === "contains" || filter.op === "not_contains") {
    const haystack = cellToText(field, value).toLowerCase();
    const needle = String(target ?? "").toLowerCase();
    const hit = needle === "" ? true : haystack.includes(needle);
    return filter.op === "contains" ? hit : !hit;
  }

  if (filter.op === "eq" || filter.op === "neq") {
    const same = Array.isArray(value)
      ? JSON.stringify(value) === JSON.stringify(target)
      : value === target;
    return filter.op === "eq" ? same : !same;
  }

  // Ordered comparisons only make sense on scalars that are actually present.
  // Without this, an empty cell would satisfy `>= 3`, because the comparator
  // deliberately orders empties last rather than reporting them incomparable.
  if (isEmpty(value) || isEmpty(target)) return false;

  const left = compareValues(field.field_type, value, target);
  if (left === null) return false;
  switch (filter.op) {
    case "gt":
      return left > 0;
    case "gte":
      return left >= 0;
    case "lt":
      return left < 0;
    case "lte":
      return left <= 0;
  }
}

export function applyFilters(rows: Row[], fields: Field[], filters: Filter[]): Row[] {
  if (filters.length === 0) return rows;
  const byId = new Map(fields.map((f) => [f.id, f]));

  return rows.filter((row) =>
    filters.every((filter) => {
      const field = byId.get(filter.fieldId);
      // A filter on a deleted column should not silently hide every row.
      if (!field) return true;
      return matchesFilter(field, coerceCell(field.field_type, row.data[filter.fieldId]), filter);
    }),
  );
}

/* -------------------------------------------------------------------------
   Sorting
   ------------------------------------------------------------------------- */

export type Sort = { fieldId: string; direction: "asc" | "desc" };

/**
 * -1, 0, 1, or null when the pair is not orderable.
 *
 * Empty values are NOT given a position here. Ordering them is a policy
 * decision that belongs to the caller: `applySorts` pins them last in both
 * directions, while `matchesFilter` refuses to compare them at all. Baking
 * "empty sorts last" into the comparator made descending sorts put empties
 * first, because the direction flip inverted it.
 */
export function compareValues(type: FieldType, a: CellValue, b: CellValue): number | null {
  if (a === null && b === null) return 0;
  if (a === null || b === null) return null;

  if (type === "number" || type === "currency") {
    const na = typeof a === "number" ? a : Number(a);
    const nb = typeof b === "number" ? b : Number(b);
    if (Number.isNaN(na) || Number.isNaN(nb)) return null;
    return Math.sign(na - nb);
  }

  if (type === "checkbox") return Math.sign(Number(Boolean(a)) - Number(Boolean(b)));

  if (Array.isArray(a) || Array.isArray(b)) return null;

  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: "base" });
}

export function applySorts(rows: Row[], fields: Field[], sorts: Sort[]): Row[] {
  if (sorts.length === 0) return [...rows].sort((a, b) => a.position - b.position);
  const byId = new Map(fields.map((f) => [f.id, f]));

  return [...rows].sort((rowA, rowB) => {
    for (const sort of sorts) {
      const field = byId.get(sort.fieldId);
      if (!field) continue;
      const a = coerceCell(field.field_type, rowA.data[sort.fieldId]);
      const b = coerceCell(field.field_type, rowB.data[sort.fieldId]);

      // Empty cells sink to the bottom either way, which is what a spreadsheet
      // does. Decided before the direction flip so descending cannot invert it.
      const aEmpty = isEmpty(a);
      const bEmpty = isEmpty(b);
      if (aEmpty && bEmpty) continue;
      if (aEmpty) return 1;
      if (bEmpty) return -1;

      const result = compareValues(field.field_type, a, b);
      if (result === null || result === 0) continue;
      return sort.direction === "asc" ? result : -result;
    }
    // Stable tail-break so equal rows keep a deterministic order.
    return rowA.position - rowB.position;
  });
}

/** Filter, then sort. The order matters: sorting a filtered set is cheaper. */
export function viewRows(rows: Row[], fields: Field[], filters: Filter[], sorts: Sort[]): Row[] {
  return applySorts(applyFilters(rows, fields, filters), fields, sorts);
}

/** Group rows by a select field, for the board view. */
export function groupRows(
  rows: Row[],
  field: Field,
): Array<{ choice: SelectChoice | null; rows: Row[] }> {
  const choices = field.options.choices ?? [];
  const groups = choices.map((choice) => ({
    choice,
    rows: rows.filter((r) => coerceCell(field.field_type, r.data[field.id]) === choice.id),
  }));

  const assigned = new Set(groups.flatMap((g) => g.rows.map((r) => r.id)));
  const ungrouped = rows.filter((r) => !assigned.has(r.id));

  // The "no value" lane comes last, and only when it has something in it.
  return ungrouped.length > 0 ? [...groups, { choice: null, rows: ungrouped }] : groups;
}
