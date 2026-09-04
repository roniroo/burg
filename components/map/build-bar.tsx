"use client";

import { BUILDING_GLYPH, BUILDING_NOUN, type ArtifactType } from "@/lib/artifacts";

export type BuildDraft =
  | { kind: "building"; artifactType: ArtifactType; title: string }
  | { kind: "district"; name: string; biome: Biome; width: number; height: number };

export type Biome = "downtown" | "harbor" | "forest" | "desert" | "snow";

const BIOMES: Biome[] = ["downtown", "harbor", "forest", "desert", "snow"];

const TYPES: ArtifactType[] = ["doc", "table", "board", "kiosk", "canvas"];

/**
 * Build mode's controls.
 *
 * Choosing the building type is choosing the artifact type -- the sprite is
 * the schema -- so this is a single decision, not two.
 */
export function BuildBar({
  draft,
  onChange,
  onCancel,
  hint,
}: {
  draft: BuildDraft;
  onChange: (next: BuildDraft) => void;
  onCancel: () => void;
  hint: string | null;
}) {
  return (
    <div className="pointer-events-auto flex flex-wrap items-center gap-2 border-2 border-ink bg-paper p-2 shadow-hard-lg">
      <div role="radiogroup" aria-label="What to build" className="flex gap-1">
        <button
          type="button"
          role="radio"
          aria-checked={draft.kind === "building"}
          onClick={() =>
            onChange({ kind: "building", artifactType: "doc", title: "" })
          }
          className="border-2 border-ink px-2 py-1 font-pixel text-[10px] uppercase shadow-hard"
          style={{ backgroundColor: draft.kind === "building" ? "var(--color-gold)" : "var(--color-snow)" }}
        >
          Building
        </button>
        <button
          type="button"
          role="radio"
          aria-checked={draft.kind === "district"}
          onClick={() =>
            onChange({ kind: "district", name: "", biome: "downtown", width: 8, height: 6 })
          }
          className="border-2 border-ink px-2 py-1 font-pixel text-[10px] uppercase shadow-hard"
          style={{ backgroundColor: draft.kind === "district" ? "var(--color-gold)" : "var(--color-snow)" }}
        >
          District
        </button>
      </div>

      <span aria-hidden className="text-stone">|</span>

      {draft.kind === "building" ? (
        <>
          <div role="radiogroup" aria-label="Building type" className="flex gap-1">
            {TYPES.map((type) => (
              <button
                key={type}
                type="button"
                role="radio"
                aria-checked={draft.artifactType === type}
                onClick={() => onChange({ ...draft, artifactType: type })}
                className="border-2 border-ink px-2 py-1 font-pixel text-[10px] uppercase shadow-hard"
                style={{
                  backgroundColor: draft.artifactType === type ? "var(--color-gold)" : "var(--color-snow)",
                }}
              >
                <span aria-hidden className="mr-1">
                  {BUILDING_GLYPH[type]}
                </span>
                {BUILDING_NOUN[type]}
              </button>
            ))}
          </div>

          <label htmlFor="build-title" className="sr-only">
            Name
          </label>
          <input
            id="build-title"
            value={draft.title}
            onChange={(e) => onChange({ ...draft, title: e.target.value })}
            placeholder="Name it…"
            className="w-48 border-2 border-ink bg-snow px-2 py-1 font-body text-sm"
          />
        </>
      ) : (
        <>
          <label htmlFor="district-name" className="sr-only">
            District name
          </label>
          <input
            id="district-name"
            value={draft.name}
            onChange={(e) => onChange({ ...draft, name: e.target.value })}
            placeholder="District name…"
            className="w-44 border-2 border-ink bg-snow px-2 py-1 font-body text-sm"
          />

          <label htmlFor="district-biome" className="sr-only">
            Biome
          </label>
          <select
            id="district-biome"
            value={draft.biome}
            onChange={(e) => onChange({ ...draft, biome: e.target.value as Biome })}
            className="border-2 border-ink bg-snow px-2 py-1 font-pixel text-[10px] uppercase"
          >
            {BIOMES.map((biome) => (
              <option key={biome} value={biome}>
                {biome}
              </option>
            ))}
          </select>

          <label htmlFor="district-w" className="font-pixel text-[10px] uppercase text-stone">
            Size
          </label>
          <input
            id="district-w"
            type="number"
            min={3}
            max={40}
            value={draft.width}
            onChange={(e) => onChange({ ...draft, width: Number(e.target.value) || 3 })}
            aria-label="District width in tiles"
            className="w-16 border-2 border-ink bg-snow px-1 py-1 font-body text-sm"
          />
          <span aria-hidden className="text-stone">×</span>
          <input
            type="number"
            min={3}
            max={40}
            value={draft.height}
            onChange={(e) => onChange({ ...draft, height: Number(e.target.value) || 3 })}
            aria-label="District height in tiles"
            className="w-16 border-2 border-ink bg-snow px-1 py-1 font-body text-sm"
          />
        </>
      )}

      <button
        type="button"
        onClick={onCancel}
        className="border-2 border-ink bg-snow px-2 py-1 font-pixel text-[10px] uppercase shadow-hard"
      >
        Cancel
      </button>

      <p role="status" aria-live="polite" className="w-full font-body text-xs text-stone">
        {hint ??
          (draft.kind === "building"
            ? "Click a lot to build. Arrow keys move the cursor, Enter places."
            : "Click to place the district's top corner. Arrow keys move, Enter places.")}
      </p>
    </div>
  );
}


