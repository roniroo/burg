"use client";

import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { cellToText, coerceCell, groupRows, type CellValue, type Field, type Row } from "@/lib/table/model";
import { swatchFor } from "./table-cell";

/**
 * Board view: one lane per choice of a select column.
 *
 * dnd-kit carries the drag, which also gives keyboard dragging (space to
 * lift, arrows to move, space to drop) without extra work -- the reason it is
 * here rather than a hand-rolled pointer handler.
 */
export function TableBoard({
  fields,
  rows,
  groupField,
  titleField,
  onCellChange,
  onOpenRow,
}: {
  fields: Field[];
  rows: Row[];
  groupField: Field;
  titleField: Field | undefined;
  onCellChange: (rowId: string, fieldId: string, value: CellValue) => void;
  onOpenRow: (rowId: string) => void;
}) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }), useSensor(KeyboardSensor));
  const groups = groupRows(rows, groupField);

  function onDragEnd(event: DragEndEvent) {
    const rowId = String(event.active.id);
    const laneId = event.over ? String(event.over.id) : null;
    if (!laneId) return;
    onCellChange(rowId, groupField.id, laneId === "__none__" ? null : laneId);
  }

  return (
    <DndContext sensors={sensors} onDragEnd={onDragEnd}>
      <div className="flex gap-3 overflow-x-auto pb-2">
        {groups.map((group) => (
          <Lane
            key={group.choice?.id ?? "__none__"
            }
            id={group.choice?.id ?? "__none__"}
            label={group.choice?.label ?? "No value"}
            color={group.choice?.color ?? 0}
            count={group.rows.length}
          >
            {group.rows.map((row) => (
              <Card
                key={row.id}
                row={row}
                // The lane already states the grouping value; repeating it on
                // every card is noise.
                fields={fields.filter((f) => f.id !== groupField.id)}
                titleField={titleField}
                onOpen={() => onOpenRow(row.id)}
              />
            ))}
          </Lane>
        ))}
      </div>
    </DndContext>
  );
}

function Lane({
  id,
  label,
  color,
  count,
  children,
}: {
  id: string;
  label: string;
  color: number;
  count: number;
  children: React.ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id });

  return (
    <section
      ref={setNodeRef}
      aria-label={`${label}, ${count} items`}
      className="flex w-64 shrink-0 flex-col border-2 border-ink bg-snow"
      style={{ outline: isOver ? "2px solid var(--color-gold)" : undefined }}
    >
      <header className="flex items-center justify-between border-b-2 border-ink px-2 py-1">
        <span
          className="border-2 border-ink px-1 font-pixel text-[10px] uppercase"
          style={{ backgroundColor: color ? swatchFor(color) : "var(--color-mist)" }}
        >
          {label}
        </span>
        <span className="font-pixel text-[10px] text-stone">{count}</span>
      </header>
      <div className="flex min-h-24 flex-col gap-2 p-2">{children}</div>
    </section>
  );
}

function Card({
  row,
  fields,
  titleField,
  onOpen,
}: {
  row: Row;
  fields: Field[];
  titleField: Field | undefined;
  onOpen: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: row.id });

  const title = titleField
    ? cellToText(titleField, coerceCell(titleField.field_type, row.data[titleField.id]))
    : row.id.slice(0, 8);

  const detail = fields
    .filter((f) => f.id !== titleField?.id)
    .slice(0, 2)
    .map((f) => cellToText(f, coerceCell(f.field_type, row.data[f.id])))
    .filter(Boolean)
    .join(" · ");

  return (
    <article
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      className="border-2 border-ink bg-paper p-2 shadow-hard"
      style={{
        // Whole pixels only, even mid-drag.
        transform: transform ? `translate(${Math.round(transform.x)}px, ${Math.round(transform.y)}px)` : undefined,
        opacity: isDragging ? 0.6 : 1,
        cursor: "grab",
      }}
    >
      <button
        type="button"
        onClick={onOpen}
        className="text-left font-body text-sm font-semibold underline decoration-mist underline-offset-2"
      >
        {title || "Untitled"}
      </button>
      {detail ? <p className="mt-1 font-body text-xs text-stone">{detail}</p> : null}
    </article>
  );
}
