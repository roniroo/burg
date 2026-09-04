"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Command } from "cmdk";
import { searchCity, type SearchHit } from "@/lib/actions/search";

const KIND_LABEL: Record<SearchHit["kind"], string> = {
  neighborhood: "District",
  building: "Building",
  document: "In a document",
  row: "Table row",
  note: "Note",
};

const KIND_GLYPH: Record<SearchHit["kind"], string> = {
  neighborhood: "▧",
  building: "▤",
  document: "▤",
  row: "▦",
  note: "▣",
};

/**
 * The command palette.
 *
 * The city is never the only way in: everything the map can reach is one
 * ⌘K away, and the results are the same Postgres index /directory uses.
 */
export function CommandPalette({ cityId }: { cityId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "k" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        setOpen((v) => !v);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  // Debounced: a keystroke should not be a round trip. Clearing when the box
  // empties happens in the change handler rather than here, because setting
  // state synchronously inside an effect costs an extra render pass.
  useEffect(() => {
    const trimmed = query.trim();
    if (!open || !trimmed) return;

    const id = window.setTimeout(() => {
      startTransition(async () => {
        setHits(await searchCity({ cityId, query: trimmed }));
      });
    }, 180);
    return () => window.clearTimeout(id);
  }, [query, open, cityId]);

  function go(hit: SearchHit) {
    setOpen(false);
    setQuery("");
    if (hit.kind === "neighborhood") router.push(`/directory`);
    else if (hit.buildingId) router.push(`/b/${hit.buildingId}`);
  }

  return (
    <Command.Dialog
      open={open}
      onOpenChange={setOpen}
      label="Search the city"
      className="fixed inset-0 z-[100] flex items-start justify-center bg-ink/40 p-4 pt-24"
      // cmdk filters client-side by default; ours come pre-ranked from Postgres.
      shouldFilter={false}
    >
      <div className="w-full max-w-xl border-2 border-ink bg-paper shadow-hard-lg">
        <Command.Input
          value={query}
          onValueChange={(next) => {
            setQuery(next);
            if (!next.trim()) setHits([]);
          }}
          placeholder="Search buildings, documents, rows and notes…"
          className="w-full border-b-2 border-ink bg-snow px-3 py-2 font-body text-sm outline-none"
        />

        <Command.List className="max-h-80 overflow-y-auto">
          {query.trim() && !pending && hits.length === 0 ? (
            <Command.Empty className="px-3 py-4 font-body text-sm text-stone">
              Nothing by that name.
            </Command.Empty>
          ) : null}

          {hits.map((hit) => (
            <Command.Item
              key={`${hit.kind}-${hit.id}`}
              value={`${hit.kind}-${hit.id}`}
              onSelect={() => go(hit)}
              className="flex cursor-pointer items-baseline gap-2 px-3 py-2 font-body text-sm data-[selected=true]:bg-gold"
            >
              <span aria-hidden className="font-pixel text-xs">
                {KIND_GLYPH[hit.kind]}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate">{hit.title || "Untitled"}</span>
                {hit.snippet ? (
                  <span className="block truncate font-body text-xs text-stone">{hit.snippet}</span>
                ) : null}
              </span>
              <span className="font-pixel text-[10px] uppercase text-stone">{KIND_LABEL[hit.kind]}</span>
            </Command.Item>
          ))}
        </Command.List>

        <footer className="border-t-2 border-ink px-3 py-1 font-pixel text-[10px] uppercase text-stone">
          ↑↓ to move · ↵ to open · esc to close
        </footer>
      </div>
    </Command.Dialog>
  );
}
