"use client";

import { cellToText, coerceCell, type Field, type Row } from "@/lib/table/model";
import { CellDisplay } from "./table-cell";

/** Gallery view: one card per row, showing the first few visible columns. */
export function TableGallery({
  fields,
  rows,
  titleField,
  onOpenRow,
}: {
  fields: Field[];
  rows: Row[];
  titleField: Field | undefined;
  onOpenRow: (rowId: string) => void;
}) {
  const detailFields = fields.filter((f) => f.id !== titleField?.id).slice(0, 4);

  return (
    <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {rows.map((row) => (
        <li key={row.id} className="border-2 border-ink bg-snow p-3 shadow-hard">
          <button
            type="button"
            onClick={() => onOpenRow(row.id)}
            className="text-left font-body text-sm font-semibold underline decoration-mist underline-offset-2"
          >
            {titleField
              ? cellToText(titleField, coerceCell(titleField.field_type, row.data[titleField.id])) || "Untitled"
              : "Untitled"}
          </button>

          <dl className="mt-2 flex flex-col gap-1">
            {detailFields.map((field) => (
              <div key={field.id} className="flex gap-2 font-body text-xs">
                <dt className="w-20 shrink-0 font-pixel text-[10px] uppercase text-stone">{field.name}</dt>
                <dd className="min-w-0 flex-1">
                  <CellDisplay field={field} value={coerceCell(field.field_type, row.data[field.id])} />
                </dd>
              </div>
            ))}
          </dl>
        </li>
      ))}
    </ul>
  );
}
