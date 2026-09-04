"use client";

import { useOptimistic, useRef, useState, useTransition } from "react";
import type { Database } from "@/lib/database.types";
import { addKioskLink, deleteKioskLink, updateKioskLink } from "@/lib/actions/kiosk";
import { SaveIndicator, type SaveState } from "./save-indicator";

type KioskLink = Database["public"]["Tables"]["kiosk_links"]["Row"];

/**
 * The Newsstand: an ordered rack of links.
 *
 * Adds are optimistic -- the row appears immediately with a placeholder title
 * while the server fetches OpenGraph -- and roll back if the action fails.
 */
export function Newsstand({ buildingId, links }: { buildingId: string; links: KioskLink[] }) {
  const [pending, startTransition] = useTransition();
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [save, setSave] = useState<SaveState>("idle");
  const inputRef = useRef<HTMLInputElement>(null);

  type Optimistic =
    | { kind: "add"; url: string }
    | { kind: "delete"; id: string };

  const [shown, apply] = useOptimistic(links, (current: KioskLink[], action: Optimistic) => {
    if (action.kind === "delete") return current.filter((l) => l.id !== action.id);
    return [
      ...current,
      {
        id: `optimistic-${action.url}`,
        city_id: "",
        building_id: buildingId,
        title: "Fetching title…",
        url: action.url,
        og_image_url: null,
        note: "",
        storage_path: null,
        position: current.length,
      } satisfies KioskLink,
    ];
  });

  function onAdd(event: React.FormEvent) {
    event.preventDefault();
    const value = url.trim();
    if (!value) return;

    setError(null);
    setSave("saving");
    setUrl("");
    inputRef.current?.focus();

    startTransition(async () => {
      apply({ kind: "add", url: value });
      const result = await addKioskLink({ buildingId, url: value });
      if (result.ok) {
        setSave("saved");
      } else {
        setSave("error");
        setError(result.error);
        setUrl(value);
      }
    });
  }

  function onDelete(id: string) {
    setSave("saving");
    startTransition(async () => {
      apply({ kind: "delete", id });
      const result = await deleteKioskLink({ id, buildingId });
      setSave(result.ok ? "saved" : "error");
      if (!result.ok) setError(result.error);
    });
  }

  return (
    <div className="flex flex-col gap-6">
      <form onSubmit={onAdd} className="flex flex-wrap items-end gap-2">
        <div className="flex min-w-64 flex-1 flex-col gap-1">
          <label htmlFor="kiosk-url" className="font-pixel text-[10px] uppercase text-stone">
            Add a link
          </label>
          <input
            id="kiosk-url"
            ref={inputRef}
            type="text"
            inputMode="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://example.com/article"
            className="border-2 border-ink bg-paper px-3 py-2 font-body text-sm"
          />
        </div>
        <button
          type="submit"
          disabled={pending || url.trim().length === 0}
          className="border-2 border-ink bg-amber px-3 py-2 font-pixel text-xs uppercase shadow-hard transition-transform duration-150 hover:translate-x-px hover:translate-y-px hover:shadow-hard-none disabled:opacity-50"
        >
          Add
        </button>
        <SaveIndicator state={save} />
      </form>

      {error ? (
        <p role="alert" className="border-2 border-brick bg-rose px-3 py-2 font-body text-sm">
          {error}
        </p>
      ) : null}

      {shown.length === 0 ? (
        <p className="font-body text-sm text-stone">
          Nothing on the rack yet. Paste a link above.
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {shown.map((link) => (
            <li key={link.id} data-kiosk-link className="flex gap-3 border-2 border-ink bg-snow p-3 shadow-hard">
              {link.og_image_url ? (
                /* Deliberately not next/image: these come from arbitrary
                   remote hosts pasted by the user, and routing them through
                   the optimiser adds cost and a failure mode for no benefit
                   at this size. */
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={link.og_image_url}
                  alt=""
                  width={96}
                  height={72}
                  className="h-18 w-24 shrink-0 border-2 border-ink object-cover"
                />
              ) : null}

              <div className="min-w-0 flex-1">
                <a
                  href={link.url}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="font-body text-sm font-semibold underline decoration-mist underline-offset-4"
                >
                  {link.title || link.url}
                </a>
                <p className="truncate font-body text-xs text-stone">{link.url}</p>

                <NoteField
                  linkId={link.id}
                  buildingId={buildingId}
                  initial={link.note}
                  disabled={link.id.startsWith("optimistic-")}
                />
              </div>

              <button
                type="button"
                onClick={() => onDelete(link.id)}
                disabled={link.id.startsWith("optimistic-")}
                aria-label={`Remove ${link.title || link.url}`}
                className="h-8 shrink-0 border-2 border-ink bg-paper px-2 font-pixel text-[10px] uppercase shadow-hard disabled:opacity-50"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** A note per link, saved on blur rather than on every keystroke. */
function NoteField({
  linkId,
  buildingId,
  initial,
  disabled,
}: {
  linkId: string;
  buildingId: string;
  initial: string;
  disabled: boolean;
}) {
  const [note, setNote] = useState(initial);
  const [, startTransition] = useTransition();

  return (
    <input
      type="text"
      value={note}
      disabled={disabled}
      onChange={(e) => setNote(e.target.value)}
      onBlur={() => {
        if (note === initial) return;
        startTransition(async () => {
          await updateKioskLink({ id: linkId, buildingId, note });
        });
      }}
      placeholder="Add a note…"
      aria-label="Note"
      className="mt-2 w-full border-2 border-mist bg-paper px-2 py-1 font-body text-xs"
    />
  );
}
