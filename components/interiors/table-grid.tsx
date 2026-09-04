"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { cellToText, coerceCell, type CellValue, type Field, type Row } from "@/lib/table/model";
import { CellDisplay, CellEditor } from "./table-cell";

const ROW_H = 34;
const GUTTER_W = 44;

export type Selection = { row: number; col: number };

/**
 * The virtualized grid.
 *
 * Only the visible rows exist in the DOM, so a few thousand rows scroll
 * without the browser noticing. Selection is (row, col) indices into the
 * *displayed* order, not row ids, because that is what arrow keys move
 * through.
 */
export function TableGrid({
  fields,
  rows,
  onCellChange,
  onPaste,
  onOpenRow,
  onResizeField,
}: {
  fields: Field[];
  rows: Row[];
  onCellChange: (rowId: string, fieldId: string, value: CellValue) => void;
  onPaste: (cells: Array<{ rowId: string; fieldId: string; value: CellValue }>) => void;
  onOpenRow: (rowId: string) => void;
  onResizeField: (fieldId: string, width: number) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [anchor, setAnchor] = useState<Selection | null>(null);
  const [editing, setEditing] = useState<Selection | null>(null);

  // React Compiler cannot memoize TanStack Virtual's returned functions. That
  // is fine here: none of them are passed into a memoized child, they are only
  // called during this component's own render.
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_H,
    overscan: 12,
  });

  const totalWidth = useMemo(
    () => GUTTER_W + fields.reduce((sum, f) => sum + f.width, 0),
    [fields],
  );

  /** The rectangle covered by the current selection, normalised. */
  const range = useMemo(() => {
    if (!selection) return null;
    const other = anchor ?? selection;
    return {
      top: Math.min(selection.row, other.row),
      bottom: Math.max(selection.row, other.row),
      left: Math.min(selection.col, other.col),
      right: Math.max(selection.col, other.col),
    };
  }, [selection, anchor]);

  const inRange = useCallback(
    (row: number, col: number) =>
      !!range && row >= range.top && row <= range.bottom && col >= range.left && col <= range.right,
    [range],
  );

  const move = useCallback(
    (dRow: number, dCol: number, extend: boolean) => {
      setSelection((current) => {
        const from = current ?? { row: 0, col: 0 };
        const next = {
          row: Math.min(rows.length - 1, Math.max(0, from.row + dRow)),
          col: Math.min(fields.length - 1, Math.max(0, from.col + dCol)),
        };
        if (!extend) setAnchor(next);
        virtualizer.scrollToIndex(next.row, { align: "auto" });
        return next;
      });
    },
    [rows.length, fields.length, virtualizer],
  );

  const copySelection = useCallback(async () => {
    if (!range) return;
    const lines: string[] = [];
    for (let r = range.top; r <= range.bottom; r++) {
      const row = rows[r];
      if (!row) continue;
      const cells: string[] = [];
      for (let c = range.left; c <= range.right; c++) {
        const field = fields[c];
        if (!field) continue;
        cells.push(cellToText(field, coerceCell(field.field_type, row.data[field.id])));
      }
      lines.push(cells.join("\t"));
    }
    try {
      await navigator.clipboard.writeText(lines.join("\n"));
    } catch {
      // Clipboard permission denied; nothing useful to do but not crash.
    }
  }, [range, rows, fields]);

  const pasteFromClipboard = useCallback(async () => {
    if (!selection) return;
    let text = "";
    try {
      text = await navigator.clipboard.readText();
    } catch {
      return;
    }
    if (!text) return;

    const cells: Array<{ rowId: string; fieldId: string; value: CellValue }> = [];
    const lines = text.replace(/\r\n?/g, "\n").replace(/\n$/, "").split("\n");

    lines.forEach((line, dr) => {
      line.split("\t").forEach((raw, dc) => {
        const row = rows[selection.row + dr];
        const field = fields[selection.col + dc];
        // Paste is clipped to the existing grid rather than growing it.
        if (!row || !field) return;
        cells.push({ rowId: row.id, fieldId: field.id, value: coerceCell(field.field_type, raw) });
      });
    });

    if (cells.length > 0) onPaste(cells);
  }, [selection, rows, fields, onPaste]);

  function onKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (editing) return;

    const meta = event.metaKey || event.ctrlKey;
    if (meta && event.key.toLowerCase() === "c") {
      event.preventDefault();
      void copySelection();
      return;
    }
    if (meta && event.key.toLowerCase() === "v") {
      event.preventDefault();
      void pasteFromClipboard();
      return;
    }

    switch (event.key) {
      case "ArrowUp":
        event.preventDefault();
        move(-1, 0, event.shiftKey);
        return;
      case "ArrowDown":
        event.preventDefault();
        move(1, 0, event.shiftKey);
        return;
      case "ArrowLeft":
        event.preventDefault();
        move(0, -1, event.shiftKey);
        return;
      case "ArrowRight":
      case "Tab":
        event.preventDefault();
        move(0, event.shiftKey && event.key === "Tab" ? -1 : 1, false);
        return;
      case "Enter":
        event.preventDefault();
        if (selection) setEditing(selection);
        return;
      case "Escape":
        setAnchor(null);
        return;
      default:
        // A printable character starts editing, as in a spreadsheet.
        if (selection && event.key.length === 1 && !meta) setEditing(selection);
    }
  }

  const commit = (row: Row, field: Field, value: CellValue) => {
    onCellChange(row.id, field.id, value);
    setEditing(null);
  };

  return (
    <div
      role="grid"
      aria-rowcount={rows.length + 1}
      aria-colcount={fields.length}
      tabIndex={0}
      onKeyDown={onKeyDown}
      className="border-2 border-ink bg-paper outline-none"
    >
      {/* Header */}
      <div role="row" className="flex border-b-2 border-ink bg-mist" style={{ width: totalWidth }}>
        <div role="columnheader" style={{ width: GUTTER_W }} className="shrink-0 border-r-2 border-ink" />
        {fields.map((field) => (
          <div
            key={field.id}
            role="columnheader"
            className="relative flex shrink-0 items-center border-r border-ink px-2 py-1 font-pixel text-[10px] uppercase"
            style={{ width: field.width }}
          >
            <span className="truncate">{field.name}</span>
            <ResizeHandle field={field} onResize={onResizeField} />
          </div>
        ))}
      </div>

      {/* Body */}
      <div ref={scrollRef} className="max-h-[60vh] overflow-auto">
        <div style={{ height: virtualizer.getTotalSize(), width: totalWidth, position: "relative" }}>
          {virtualizer.getVirtualItems().map((virtualRow) => {
            const row = rows[virtualRow.index];
            if (!row) return null;

            return (
              <div
                key={row.id}
                role="row"
                aria-rowindex={virtualRow.index + 2}
                className="absolute left-0 flex border-b border-mist"
                style={{ top: virtualRow.start, height: ROW_H, width: totalWidth }}
              >
                <div
                  role="rowheader"
                  style={{ width: GUTTER_W }}
                  className="flex shrink-0 items-center justify-center border-r-2 border-ink bg-snow"
                >
                  <button
                    type="button"
                    onClick={() => onOpenRow(row.id)}
                    aria-label={`Open row ${virtualRow.index + 1}`}
                    className="font-pixel text-[10px] text-stone hover:text-ink"
                  >
                    ⤢
                  </button>
                </div>

                {fields.map((field, col) => {
                  const isEditing = editing?.row === virtualRow.index && editing.col === col;
                  const isSelected = selection?.row === virtualRow.index && selection.col === col;
                  const value = coerceCell(field.field_type, row.data[field.id]);

                  return (
                    <div
                      key={field.id}
                      role="gridcell"
                      aria-colindex={col + 1}
                      aria-selected={isSelected}
                      onMouseDown={() => {
                        setSelection({ row: virtualRow.index, col });
                        setAnchor({ row: virtualRow.index, col });
                      }}
                      onDoubleClick={() => setEditing({ row: virtualRow.index, col })}
                      className="relative flex shrink-0 items-center overflow-hidden whitespace-nowrap border-r border-mist px-2 font-body text-sm"
                      style={{
                        width: field.width,
                        backgroundColor: isSelected
                          ? "var(--color-gold)"
                          : inRange(virtualRow.index, col)
                            ? "var(--color-sand)"
                            : undefined,
                      }}
                    >
                      {isEditing ? (
                        <CellEditor
                          field={field}
                          value={value}
                          onCommit={(next) => commit(row, field, next)}
                          onCancel={() => setEditing(null)}
                        />
                      ) : (
                        <CellDisplay field={field} value={value} />
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/** Drag the right edge of a header to resize. Width persists per field. */
function ResizeHandle({ field, onResize }: { field: Field; onResize: (id: string, width: number) => void }) {
  const start = useRef<{ x: number; width: number } | null>(null);

  return (
    <span
      role="separator"
      aria-orientation="vertical"
      aria-label={`Resize ${field.name}`}
      className="absolute right-0 top-0 h-full w-1 cursor-col-resize bg-transparent hover:bg-ink"
      onPointerDown={(event) => {
        event.preventDefault();
        start.current = { x: event.clientX, width: field.width };
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        if (!start.current) return;
        const next = Math.max(48, Math.min(1200, start.current.width + (event.clientX - start.current.x)));
        onResize(field.id, Math.round(next));
      }}
      onPointerUp={() => {
        start.current = null;
      }}
    />
  );
}
