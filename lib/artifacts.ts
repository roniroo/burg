import type { Database } from "@/lib/database.types";

export type ArtifactType = Database["public"]["Enums"]["artifact_type"];

/**
 * Presentation constants for artifact types.
 *
 * Deliberately free of any server import so client components can use them
 * without dragging `next/headers` into the browser bundle.
 */

/** Building type -> the city noun it wears, for labels and accessible names. */
export const BUILDING_NOUN: Record<ArtifactType, string> = {
  doc: "Library",
  table: "Warehouse",
  board: "Noticeboard",
  canvas: "Studio",
  kiosk: "Newsstand",
};

/** Silhouette is not the only signal: every type also carries a glyph. */
export const BUILDING_GLYPH: Record<ArtifactType, string> = {
  doc: "▤",
  table: "▦",
  board: "▣",
  canvas: "◈",
  kiosk: "▥",
};
