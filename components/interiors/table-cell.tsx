"use client";

import { useEffect, useRef, useState } from "react";
import { cellToText, coerceCell, labelForChoice, type CellValue, type Field } from "@/lib/table/model";

/**
 * Six pixel swatches, shared with board notes. Index 1-6.
 *
 * Tinted toward paper rather than used at full saturation: these carry 12px
 * ink text, and the saturated forms measured as low as 4.33:1, under the 4.5
 * minimum. The tint keeps the hue recognisable and clears the threshold.
 */
export const SWATCH = [
  "color-mix(in srgb, var(--color-gold) 55%, var(--color-paper))",
  "color-mix(in srgb, var(--color-lime) 55%, var(--color-paper))",
  "color-mix(in srgb, var(--color-sky) 55%, var(--color-paper))",
  "color-mix(in srgb, var(--color-clay) 55%, var(--color-paper))",
  "color-mix(in srgb, var(--color-rose) 55%, var(--color-paper))",
  "color-mix(in srgb, var(--color-orchid) 55%, var(--color-paper))",
] as const;

export function swatchFor(color: number): string {
  return SWATCH[(color - 1) % SWATCH.length] ?? SWATCH[0];
}

/** Read-only cell contents. Kept cheap: thousands of these exist at once. */
export function CellDisplay({ field, value }: { field: Field; value: CellValue }) {
  if (value === null || value === undefined || (Array.isArray(value) && value.length === 0)) {
    return <span className="text-ash">—</span>;
  }

  if (field.field_type === "checkbox") {
    return (
      <span
        aria-hidden
        className="inline-block h-3.5 w-3.5 border-2 border-ink"
        style={{ backgroundColor: value ? "var(--color-grass)" : "var(--color-paper)" }}
      />
    );
  }

  if (field.field_type === "select") {
    const choice = field.options.choices?.find((c) => c.id === String(value));
    return (
      <span
        className="border-2 border-ink px-1 text-xs"
        style={{ backgroundColor: swatchFor(choice?.color ?? 1) }}
      >
        {labelForChoice(field, String(value))}
      </span>
    );
  }

  if (field.field_type === "multi_select" && Array.isArray(value)) {
    return (
      <span className="flex flex-wrap gap-1">
        {value.map((id) => {
          const choice = field.options.choices?.find((c) => c.id === id);
          return (
            <span
              key={id}
              className="border-2 border-ink px-1 text-xs"
              style={{ backgroundColor: swatchFor(choice?.color ?? 1) }}
            >
              {labelForChoice(field, id)}
            </span>
          );
        })}
      </span>
    );
  }

  if (field.field_type === "url") {
    return (
      <a
        href={String(value)}
        target="_blank"
        rel="noreferrer noopener"
        className="underline decoration-mist underline-offset-2"
        onClick={(e) => e.stopPropagation()}
      >
        {String(value)}
      </a>
    );
  }

  if (field.field_type === "relation" && Array.isArray(value)) {
    return <span className="text-xs">{value.length} linked</span>;
  }

  const text = cellToText(field, value);
  const numeric = field.field_type === "number" || field.field_type === "currency";
  return (
    <span className={`block truncate ${numeric ? "tabular-nums" : ""}`} title={text}>
      {text}
    </span>
  );
}

/**
 * The editor for one cell.
 *
 * Enter and blur commit; Escape reverts. Every type is a native control, so
 * keyboard behaviour and screen-reader semantics come for free.
 */
export function CellEditor({
  field,
  value,
  onCommit,
  onCancel,
}: {
  field: Field;
  value: CellValue;
  onCommit: (next: CellValue) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState(() => (value === null ? "" : String(value)));
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    if (inputRef.current instanceof HTMLInputElement) inputRef.current.select();
  }, []);

  /**
   * Commit only a real change.
   *
   * The row panel mounts an editor per field, and every one of them blurs when
   * the panel closes. Without this guard that fired a write per column for a
   * row nobody edited -- and because Next serialises server actions per client,
   * those no-op writes queued up in front of whatever the user did next.
   */
  const commitText = () => {
    const next = coerceCell(field.field_type, draft);
    if (next === value || (next === null && value === null)) {
      onCancel();
      return;
    }
    onCommit(next);
  };

  const keys = (event: React.KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onCancel();
    }
    if (event.key === "Enter" && field.field_type !== "long_text") {
      event.preventDefault();
      event.stopPropagation();
      commitText();
    }
  };

  const shared =
    "h-full w-full border-2 border-gold bg-paper px-1 font-body text-sm outline-none";

  if (field.field_type === "checkbox") {
    // A checkbox has no text form to edit; toggling is the whole interaction.
    return (
      <input
        type="checkbox"
        ref={inputRef as React.Ref<HTMLInputElement>}
        defaultChecked={Boolean(value)}
        onChange={(e) => onCommit(e.target.checked)}
        onBlur={onCancel}
        onKeyDown={keys}
        className="h-4 w-4 border-2 border-ink"
      />
    );
  }

  if (field.field_type === "select") {
    return (
      <select
        ref={inputRef as React.Ref<HTMLSelectElement>}
        defaultValue={value === null ? "" : String(value)}
        onChange={(e) => onCommit(e.target.value === "" ? null : e.target.value)}
        onBlur={onCancel}
        onKeyDown={keys}
        className={shared}
      >
        <option value="">—</option>
        {(field.options.choices ?? []).map((choice) => (
          <option key={choice.id} value={choice.id}>
            {choice.label}
          </option>
        ))}
      </select>
    );
  }

  if (field.field_type === "multi_select") {
    const selected = new Set(Array.isArray(value) ? value : []);
    return (
      <div className="flex flex-wrap gap-1 border-2 border-gold bg-paper p-1">
        {(field.options.choices ?? []).map((choice) => (
          <label key={choice.id} className="flex items-center gap-1 text-xs">
            <input
              type="checkbox"
              defaultChecked={selected.has(choice.id)}
              onChange={(e) => {
                const next = new Set(selected);
                if (e.target.checked) next.add(choice.id);
                else next.delete(choice.id);
                selected.clear();
                for (const id of next) selected.add(id);
                onCommit([...next]);
              }}
            />
            {choice.label}
          </label>
        ))}
      </div>
    );
  }

  if (field.field_type === "long_text") {
    return (
      <textarea
        ref={inputRef as React.Ref<HTMLTextAreaElement>}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commitText}
        onKeyDown={keys}
        rows={3}
        className="absolute left-0 top-0 z-20 min-h-24 w-full border-2 border-gold bg-paper p-1 font-body text-sm outline-none"
      />
    );
  }

  const inputType =
    field.field_type === "number" || field.field_type === "currency"
      ? "number"
      : field.field_type === "date"
        ? "date"
        : field.field_type === "url"
          ? "url"
          : "text";

  return (
    <input
      ref={inputRef as React.Ref<HTMLInputElement>}
      type={inputType}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commitText}
      onKeyDown={keys}
      className={shared}
    />
  );
}
