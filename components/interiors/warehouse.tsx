"use client";

import { useMemo, useOptimistic, useState, useTransition } from "react";
import {
  viewRows,
  type CellValue,
  type Field,
  type Filter,
  type Row,
  type Sort,
} from "@/lib/table/model";
import { addRow, deleteRow, pasteCells, updateCell, updateField } from "@/lib/actions/table";
import { TableGrid } from "./table-grid";
import { TableBoard } from "./table-board";
import { TableGallery } from "./table-gallery";
import { RowPanel } from "./row-panel";
import { SaveIndicator, type SaveState } from "./save-indicator";

export type View = {
  id: string;
  name: string;
  view_type: "table" | "board" | "gallery";
  filters: Filter[];
  sorts: Sort[];
  hidden_fields: string[];
  group_by_field_id: string | null;
};

/**
 * The Warehouse.
 *
 * Views are the only stateful chrome: each carries its own filters, sorts and
 * hidden columns, and switching between them never touches the underlying
 * rows. Cell edits are optimistic and roll back if the server refuses.
 */
export function Warehouse({
  buildingId,
  fields: initialFields,
  rows: initialRows,
  views,
  primaryFieldId,
}: {
  buildingId: string;
  fields: Field[];
  rows: Row[];
  views: View[];
  primaryFieldId: string | null;
}) {
  const [, startTransition] = useTransition();
  const [save, setSave] = useState<SaveState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [activeViewId, setActiveViewId] = useState(views[0]?.id ?? "");
  const [openRowId, setOpenRowId] = useState<string | null>(null);
  const [fields, setFields] = useState(initialFields);

  type Patch = { rowId: string; fieldId: string; value: CellValue } | { removeRowId: string };

  const [rows, applyPatch] = useOptimistic(initialRows, (current: Row[], patch: Patch) => {
    if ("removeRowId" in patch) return current.filter((r) => r.id !== patch.removeRowId);
    return current.map((row) =>
      row.id === patch.rowId ? { ...row, data: { ...row.data, [patch.fieldId]: patch.value } } : row,
    );
  });

  const view = views.find((v) => v.id === activeViewId) ?? views[0];
  const visibleFields = useMemo(
    () => fields.filter((f) => !(view?.hidden_fields ?? []).includes(f.id)),
    [fields, view],
  );

  const displayed = useMemo(
    () => viewRows(rows, fields, view?.filters ?? [], view?.sorts ?? []),
    [rows, fields, view],
  );

  const titleField = fields.find((f) => f.id === primaryFieldId) ?? fields[0];
  const groupField = fields.find((f) => f.id === view?.group_by_field_id);

  function onCellChange(rowId: string, fieldId: string, value: CellValue) {
    setSave("saving");
    setError(null);
    startTransition(async () => {
      applyPatch({ rowId, fieldId, value });
      const result = await updateCell({ buildingId, rowId, fieldId, value });
      if (result.ok) {
        setSave("saved");
      } else {
        // The optimistic state unwinds when the transition ends; the message
        // is what tells the user the edit did not stick.
        setSave("error");
        setError(result.error);
      }
    });
  }

  function onPaste(cells: Array<{ rowId: string; fieldId: string; value: CellValue }>) {
    setSave("saving");
    startTransition(async () => {
      for (const cell of cells) applyPatch(cell);
      const result = await pasteCells({ buildingId, cells });
      setSave(result.ok ? "saved" : "error");
      if (!result.ok) setError(result.error);
    });
  }

  function onAddRow() {
    setSave("saving");
    startTransition(async () => {
      const result = await addRow({ buildingId });
      setSave(result.ok ? "saved" : "error");
      if (!result.ok) setError(result.error);
    });
  }

  function onDeleteRow(rowId: string) {
    setOpenRowId(null);
    setSave("saving");
    startTransition(async () => {
      applyPatch({ removeRowId: rowId });
      const result = await deleteRow({ buildingId, rowId });
      setSave(result.ok ? "saved" : "error");
      if (!result.ok) setError(result.error);
    });
  }

  function onResizeField(fieldId: string, width: number) {
    // Local first so the drag is smooth; persisted when the pointer settles.
    setFields((current) => current.map((f) => (f.id === fieldId ? { ...f, width } : f)));
    startTransition(async () => {
      await updateField({ buildingId, fieldId, width });
    });
  }

  const openRow = displayed.find((r) => r.id === openRowId) ?? rows.find((r) => r.id === openRowId);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <div role="tablist" aria-label="Views" className="flex gap-1">
          {views.map((v) => (
            <button
              key={v.id}
              role="tab"
              aria-selected={v.id === activeViewId}
              onClick={() => setActiveViewId(v.id)}
              className="border-2 border-ink px-2 py-1 font-pixel text-[10px] uppercase shadow-hard"
              style={{ backgroundColor: v.id === activeViewId ? "var(--color-gold)" : "var(--color-paper)" }}
            >
              {v.name}
            </button>
          ))}
        </div>

        <span className="font-pixel text-[10px] uppercase text-stone">
          {displayed.length} of {rows.length} rows
        </span>

        <div className="ml-auto flex items-center gap-2">
          <SaveIndicator state={save} />
          <button
            type="button"
            onClick={onAddRow}
            className="border-2 border-ink bg-amber px-2 py-1 font-pixel text-[10px] uppercase shadow-hard"
          >
            Add row
          </button>
        </div>
      </div>

      {error ? (
        <p role="alert" className="border-2 border-brick bg-rose px-3 py-2 font-body text-sm">
          {error}
        </p>
      ) : null}

      {view?.view_type === "board" && groupField ? (
        <TableBoard
          fields={visibleFields}
          rows={displayed}
          groupField={groupField}
          titleField={titleField}
          onCellChange={onCellChange}
          onOpenRow={setOpenRowId}
        />
      ) : view?.view_type === "gallery" ? (
        <TableGallery
          fields={visibleFields}
          rows={displayed}
          titleField={titleField}
          onOpenRow={setOpenRowId}
        />
      ) : (
        <TableGrid
          fields={visibleFields}
          rows={displayed}
          onCellChange={onCellChange}
          onPaste={onPaste}
          onOpenRow={setOpenRowId}
          onResizeField={onResizeField}
        />
      )}

      {view?.view_type === "board" && !groupField ? (
        <p className="font-body text-sm text-stone">
          This board has no grouping column yet. Pick a select column to group by.
        </p>
      ) : null}

      {openRow ? (
        <RowPanel
          row={openRow}
          fields={fields}
          onCellChange={onCellChange}
          onClose={() => setOpenRowId(null)}
          onDelete={() => onDeleteRow(openRow.id)}
        />
      ) : null}
    </div>
  );
}
