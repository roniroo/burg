"use client";

export type SaveState = "idle" | "saving" | "saved" | "error";

/**
 * A scaffold going up, not a spinner.
 *
 * Three stepped bars fill as the save runs, so the feedback matches the
 * building metaphor and does not spin smoothly against the pixel grid.
 */
export function SaveIndicator({ state }: { state: SaveState }) {
  const label =
    state === "saving" ? "Saving" : state === "saved" ? "Saved" : state === "error" ? "Not saved" : "";

  return (
    <p
      role="status"
      aria-live="polite"
      className="flex items-center gap-2 font-pixel text-[10px] uppercase text-stone"
    >
      {state !== "idle" ? (
        <span aria-hidden className="flex items-end gap-px">
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              className="w-1 border border-ink"
              style={{
                height: 4 + i * 3,
                backgroundColor:
                  state === "error"
                    ? "var(--color-brick)"
                    : state === "saved"
                      ? "var(--color-grass)"
                      : "var(--color-amber)",
                opacity: state === "saving" ? 0.4 + i * 0.3 : 1,
              }}
            />
          ))}
        </span>
      ) : null}
      {label}
    </p>
  );
}
