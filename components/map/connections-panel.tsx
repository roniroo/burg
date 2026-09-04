"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import { BUILDING_GLYPH, type ArtifactType } from "@/lib/artifacts";
import type { MapRoute } from "./road-layer";

export type RouteLink = {
  id: string;
  linkType: string;
  sourceId: string;
  sourceTitle: string;
  sourceType: ArtifactType;
  targetId: string;
  targetTitle: string;
  targetType: ArtifactType;
};

/**
 * What a road carries.
 *
 * This panel replaces a backlinks pane, so it has to be as useful as one:
 * every link the route carries, each row jumping to either end.
 */
export function ConnectionsPanel({
  route,
  label,
  links,
  onClose,
}: {
  route: MapRoute;
  label: string;
  links: RouteLink[];
  onClose: () => void;
}) {
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
    <div
      role="dialog"
      aria-modal="false"
      aria-label={`Connections: ${label}`}
      data-map-chrome
      className="absolute right-3 top-3 z-50 flex max-h-[70%] w-80 flex-col overflow-y-auto border-2 border-ink bg-paper shadow-hard-lg"
    >
      <header className="flex items-center justify-between gap-2 border-b-2 border-ink px-2 py-1">
        <span className="font-pixel text-[10px] uppercase text-ink">{label}</span>
        <button
          ref={closeRef}
          type="button"
          onClick={onClose}
          aria-label="Close connections"
          className="border-2 border-ink bg-snow px-1 font-pixel text-[10px] uppercase"
        >
          ✕
        </button>
      </header>

      <p className="border-b border-mist px-2 py-1 font-pixel text-[10px] uppercase text-stone">
        {route.tier} · {route.scope} · {route.linkCount} link{route.linkCount === 1 ? "" : "s"} ·{" "}
        {route.path.length} tiles
      </p>

      {links.length === 0 ? (
        <p className="p-2 font-body text-sm text-stone">
          This road is weathering away; nothing links these two any more.
        </p>
      ) : (
        <ul className="flex flex-col">
          {links.map((link) => (
            <li key={link.id} className="border-b border-mist px-2 py-2 font-body text-sm">
              <Link href={`/b/${link.sourceId}`} className="underline decoration-mist underline-offset-2">
                <span aria-hidden className="mr-1 font-pixel">
                  {BUILDING_GLYPH[link.sourceType]}
                </span>
                {link.sourceTitle}
              </Link>
              <span aria-hidden className="mx-1 font-pixel text-stone">
                →
              </span>
              <Link href={`/b/${link.targetId}`} className="underline decoration-mist underline-offset-2">
                <span aria-hidden className="mr-1 font-pixel">
                  {BUILDING_GLYPH[link.targetType]}
                </span>
                {link.targetTitle}
              </Link>
              <span className="ml-2 font-pixel text-[10px] uppercase text-stone">{link.linkType}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
