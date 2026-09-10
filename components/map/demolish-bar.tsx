"use client";

/** What the bar is currently offering to take down. */
export type DemolishTarget =
  | { kind: "building"; id: string; title: string; noun: string }
  | { kind: "district"; id: string; name: string; buildingCount: number };

/**
 * Demolish mode's controls.
 *
 * The mirror of BuildBar, and deliberately the same shape: build and unbuild
 * are the same kind of act on the same surface, so they get the same chrome
 * in the same corner. The bar is the confirmation step -- clicking on the map
 * only ever condemns, and only the bar knocks anything down -- which keeps a
 * stray click from destroying something.
 *
 * Buildings and districts share one bar rather than needing a mode switch:
 * what you clicked already said which you meant.
 */
export function DemolishBar({
  target,
  pending,
  hint,
  onConfirm,
  onClear,
  onExit,
}: {
  target: DemolishTarget | null;
  pending: boolean;
  hint: string | null;
  onConfirm: () => void;
  onClear: () => void;
  onExit: () => void;
}) {
  return (
    <div
      data-demolish-bar
      className="pointer-events-auto flex flex-wrap items-center gap-2 border-2 border-brick bg-paper p-2 shadow-hard-lg"
    >
      <span className="font-pixel text-[10px] uppercase text-brick">Demolish</span>
      <span aria-hidden className="text-stone">
        |
      </span>

      {target ? (
        <>
          <span className="font-body text-sm text-ink">
            {target.kind === "building" ? `${target.noun}: ` : "District: "}
            <strong className="font-semibold">
              {target.kind === "building" ? target.title : target.name}
            </strong>
          </span>
          <button
            type="button"
            autoFocus
            disabled={pending}
            onClick={onConfirm}
            className="border-2 border-ink bg-brick px-2 py-1 font-pixel text-[10px] uppercase text-paper shadow-hard disabled:opacity-50"
          >
            {pending
              ? target.kind === "building"
                ? "Demolishing…"
                : "Dissolving…"
              : target.kind === "building"
                ? "Demolish it"
                : "Dissolve it"}
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={onClear}
            className="border-2 border-ink bg-snow px-2 py-1 font-pixel text-[10px] uppercase shadow-hard disabled:opacity-50"
          >
            Keep it
          </button>
        </>
      ) : null}

      <button
        type="button"
        onClick={onExit}
        className="border-2 border-ink bg-snow px-2 py-1 font-pixel text-[10px] uppercase shadow-hard"
      >
        Done
      </button>

      <p role="status" aria-live="polite" className="w-full font-body text-xs text-stone">
        {hint ?? consequence(target)}
      </p>
    </div>
  );
}

/** What confirming would actually cost, spelled out before it happens. */
function consequence(target: DemolishTarget | null): string {
  if (!target) {
    return "Click a building to condemn it, or a district's ground to dissolve it. Arrow keys move the cursor, Enter condemns.";
  }
  if (target.kind === "building") {
    return "Everything inside comes down with it. This cannot be undone.";
  }
  if (target.buildingCount === 0) {
    return "Nothing stands in it; its ground goes back to grass. This cannot be undone.";
  }
  return `The ${target.buildingCount} building${target.buildingCount === 1 ? "" : "s"} in it come down too, with everything inside them. This cannot be undone.`;
}
