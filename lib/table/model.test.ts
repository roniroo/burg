import { describe, expect, it } from "vitest";
import {
  applyFilters,
  applySorts,
  cellToText,
  coerceCell,
  compareValues,
  groupRows,
  viewRows,
  type Field,
  type Row,
} from "./model";

const field = (over: Partial<Field> & Pick<Field, "id" | "field_type">): Field => ({
  name: over.id,
  options: {},
  position: 0,
  width: 180,
  ...over,
});

const title = field({ id: "title", field_type: "text" });
const effort = field({ id: "effort", field_type: "number" });
const done = field({ id: "done", field_type: "checkbox" });
const status = field({
  id: "status",
  field_type: "select",
  options: {
    choices: [
      { id: "planning", label: "Planning", color: 3 },
      { id: "building", label: "Building", color: 4 },
      { id: "shipped", label: "Shipped", color: 2 },
    ],
  },
});
const tags = field({
  id: "tags",
  field_type: "multi_select",
  options: { choices: [{ id: "a", label: "Alpha", color: 1 }, { id: "b", label: "Beta", color: 2 }] },
});

const fields = [title, effort, done, status, tags];

const rows: Row[] = [
  { id: "r1", position: 0, data: { title: "Queue", effort: 8, done: false, status: "building", tags: ["a"] } },
  { id: "r2", position: 1, data: { title: "Schema", effort: 3, done: true, status: "shipped", tags: ["a", "b"] } },
  { id: "r3", position: 2, data: { title: "Rollback", effort: null, done: false, status: "planning", tags: [] } },
  { id: "r4", position: 3, data: { title: "Comms", effort: 2, done: false, status: null, tags: null } },
];

describe("coerceCell", () => {
  it("keeps an absent value null rather than defaulting to zero", () => {
    // An empty number cell is not the number zero; filters depend on this.
    expect(coerceCell("number", null)).toBeNull();
    expect(coerceCell("number", "")).toBeNull();
    expect(coerceCell("text", "")).toBeNull();
  });

  it("parses numbers out of typed text", () => {
    expect(coerceCell("number", "42")).toBe(42);
    expect(coerceCell("currency", "$1,200")).toBe(1200);
    expect(coerceCell("number", "not a number")).toBeNull();
  });

  it("normalises multi-value types to arrays", () => {
    expect(coerceCell("multi_select", "a")).toEqual(["a"]);
    expect(coerceCell("multi_select", ["a", "b"])).toEqual(["a", "b"]);
    expect(coerceCell("relation", null)).toBeNull();
    expect(coerceCell("multi_select", "")).toEqual([]);
  });

  it("normalises dates to ISO days but keeps unparseable text", () => {
    expect(coerceCell("date", "2026-09-19")).toBe("2026-09-19");
    expect(coerceCell("date", "next tuesday")).toBe("next tuesday");
  });

  it("reads checkboxes from strings and numbers", () => {
    expect(coerceCell("checkbox", "true")).toBe(true);
    expect(coerceCell("checkbox", 1)).toBe(true);
    expect(coerceCell("checkbox", "no")).toBe(false);
  });
});

describe("cellToText", () => {
  it("resolves select ids to their labels", () => {
    expect(cellToText(status, "shipped")).toBe("Shipped");
    expect(cellToText(tags, ["a", "b"])).toBe("Alpha, Beta");
  });

  it("falls back to the raw id when a choice was deleted", () => {
    expect(cellToText(status, "gone")).toBe("gone");
  });

  it("formats currency and checkboxes for people, not machines", () => {
    const money = field({ id: "cost", field_type: "currency", options: { currency: "USD" } });
    expect(cellToText(money, 1200)).toBe("$1,200.00");
    expect(cellToText(done, true)).toBe("Yes");
  });

  it("renders an empty cell as an empty string", () => {
    expect(cellToText(title, null)).toBe("");
  });
});

describe("applyFilters", () => {
  const ids = (r: Row[]) => r.map((x) => x.id);

  it("matches on equality", () => {
    expect(ids(applyFilters(rows, fields, [{ fieldId: "status", op: "eq", value: "building" }]))).toEqual(["r1"]);
  });

  it("matches text case-insensitively with contains", () => {
    expect(ids(applyFilters(rows, fields, [{ fieldId: "title", op: "contains", value: "sch" }]))).toEqual(["r2"]);
  });

  it("distinguishes empty from zero", () => {
    expect(ids(applyFilters(rows, fields, [{ fieldId: "effort", op: "is_empty" }]))).toEqual(["r3"]);
    expect(ids(applyFilters(rows, fields, [{ fieldId: "effort", op: "is_not_empty" }]))).toEqual(["r1", "r2", "r4"]);
  });

  it("treats an empty multi-select as empty", () => {
    expect(ids(applyFilters(rows, fields, [{ fieldId: "tags", op: "is_empty" }]))).toEqual(["r3", "r4"]);
  });

  it("compares numbers in order", () => {
    expect(ids(applyFilters(rows, fields, [{ fieldId: "effort", op: "gte", value: 3 }]))).toEqual(["r1", "r2"]);
  });

  it("matches any of a set for multi-value fields", () => {
    expect(ids(applyFilters(rows, fields, [{ fieldId: "tags", op: "has_any", value: ["b"] }]))).toEqual(["r2"]);
  });

  it("ands multiple filters together", () => {
    const result = applyFilters(rows, fields, [
      { fieldId: "done", op: "eq", value: false },
      { fieldId: "effort", op: "is_not_empty" },
    ]);
    expect(ids(result)).toEqual(["r1", "r4"]);
  });

  it("ignores a filter on a deleted column rather than hiding everything", () => {
    // A view can outlive the field it filtered on; that must not blank the table.
    expect(ids(applyFilters(rows, fields, [{ fieldId: "ghost", op: "eq", value: "x" }]))).toEqual(ids(rows));
  });
});

describe("applySorts", () => {
  const ids = (r: Row[]) => r.map((x) => x.id);

  it("falls back to stored order with no sorts", () => {
    expect(ids(applySorts(rows, fields, []))).toEqual(["r1", "r2", "r3", "r4"]);
  });

  it("sorts numbers ascending and descending", () => {
    expect(ids(applySorts(rows, fields, [{ fieldId: "effort", direction: "asc" }]))).toEqual(["r4", "r2", "r1", "r3"]);
    expect(ids(applySorts(rows, fields, [{ fieldId: "effort", direction: "desc" }]))).toEqual(["r1", "r2", "r4", "r3"]);
  });

  it("keeps empty cells last in both directions", () => {
    // r3 has no effort; it belongs at the bottom either way.
    for (const direction of ["asc", "desc"] as const) {
      expect(ids(applySorts(rows, fields, [{ fieldId: "effort", direction }])).at(-1)).toBe("r3");
    }
  });

  it("breaks ties by stored position, so order is deterministic", () => {
    expect(ids(applySorts(rows, fields, [{ fieldId: "done", direction: "asc" }]))).toEqual(["r1", "r3", "r4", "r2"]);
  });

  it("does not mutate its input", () => {
    const before = ids(rows);
    applySorts(rows, fields, [{ fieldId: "effort", direction: "desc" }]);
    expect(ids(rows)).toEqual(before);
  });
});

describe("compareValues", () => {
  it("refuses to order values that are not orderable", () => {
    expect(compareValues("multi_select", ["a"], ["b"])).toBeNull();
    expect(compareValues("number", "abc", 1)).toBeNull();
  });

  it("compares text naturally, so 10 follows 9", () => {
    expect(compareValues("text", "item 9", "item 10")).toBeLessThan(0);
  });
});

describe("viewRows", () => {
  it("filters before sorting", () => {
    const result = viewRows(
      rows,
      fields,
      [{ fieldId: "done", op: "eq", value: false }],
      [{ fieldId: "effort", direction: "asc" }],
    );
    expect(result.map((r) => r.id)).toEqual(["r4", "r1", "r3"]);
  });
});

describe("groupRows", () => {
  it("makes one lane per choice, in choice order", () => {
    const groups = groupRows(rows, status);
    expect(groups.map((g) => g.choice?.label)).toEqual(["Planning", "Building", "Shipped", undefined]);
  });

  it("collects rows with no value into a final lane", () => {
    const groups = groupRows(rows, status);
    expect(groups.at(-1)?.choice).toBeNull();
    expect(groups.at(-1)?.rows.map((r) => r.id)).toEqual(["r4"]);
  });

  it("omits the no-value lane when every row is assigned", () => {
    const assigned = rows.filter((r) => r.data["status"] !== null);
    const groups = groupRows(assigned, status);
    expect(groups.every((g) => g.choice !== null)).toBe(true);
  });

  it("places every row in exactly one lane", () => {
    const groups = groupRows(rows, status);
    const placed = groups.flatMap((g) => g.rows.map((r) => r.id));
    expect(placed.sort()).toEqual(["r1", "r2", "r3", "r4"]);
  });
});
