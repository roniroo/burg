"use client";

import { useEffect, useRef } from "react";
import { coerceCell, type CellValue, type Field, type Row } from "@/lib/table/model";
import { CellEditor } from "./table-cell";

/**
 * Row detail, in a side panel.
 *
 * A dialog rather than a route so the grid stays behind it: the point of the
 * panel is reading one row without losing your place in the table.
 */
export function RowPanel({
  row,
  fields,
  onCellChange,
  onClose,
  onDelete,
}: {
  row: Row;
  fields: Field[];
  onCellChange: (rowId: string, fieldId: string, value: CellValue) => void;
  onClose: () => void;
  onDelete: () => void;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      <div
        className="absolute inset-0 bg-ink/40"
        onClick={onClose}
        aria-hidden
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Row detail"
        className="relative flex h-full w-full max-w-md flex-col overflow-y-auto border-l-2 border-ink bg-paper p-4 shadow-hard-lg"
      >
        <div className="flex items-center justify-between">
          <h2 className="font-pixel text-[10px] uppercase text-stone">Row detail</h2>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            className="border-2 border-ink bg-snow px-2 py-1 font-pixel text-[10px] uppercase shadow-hard"
          >
            Close
          </button>
        </div>

        <dl className="mt-4 flex flex-col gap-3">
          {fields.map((field) => (
            <div key={field.id}>
              <dt className="font-pixel text-[10px] uppercase text-stone">{field.name}</dt>
              <dd className="relative mt-1 min-h-9">
                <CellEditor
                  field={field}
                  value={coerceCell(field.field_type, row.data[field.id])}
                  onCommit={(next) => onCellChange(row.id, field.id, next)}
                  onCancel={() => {}}
                />
              </dd>
            </div>
          ))}
        </dl>

        <button
          type="button"
          onClick={onDelete}
          className="mt-6 self-start border-2 border-brick bg-rose px-3 py-1 font-pixel text-[10px] uppercase shadow-hard"
        >
          Delete row
        </button>
      </div>
    </div>
  );
}
