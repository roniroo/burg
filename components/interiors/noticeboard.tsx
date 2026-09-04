"use client";

import { useEffect, useOptimistic, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { addNote, deleteNote, promoteNote, setBoardMode, updateNote } from "@/lib/actions/board";
import { flyToSignpost, pinDown } from "@/lib/anim";
import { SWATCH } from "./table-cell";
import { SaveIndicator, type SaveState } from "./save-indicator";
import type { Database } from "@/lib/database.types";

type Note = Database["public"]["Tables"]["board_notes"]["Row"];
type Column = Database["public"]["Tables"]["board_columns"]["Row"];

export type PromoteTarget = { id: string; title: string; artifactType: string };

const NOTE_W = 168;
const NOTE_H = 120;

/**
 * The Noticeboard.
 *
 * Freeform mode pins notes at absolute positions with a small random tilt;
 * columns mode lines them up in lanes. Promotion -- turning a note into a
 * Library, a Warehouse row, or a note on another board -- is the signature
 * interaction, and gets the animation budget.
 */
export function Noticeboard({
  buildingId,
  mode: initialMode,
  notes: initialNotes,
  columns,
  promoteTargets,
}: {
  buildingId: string;
  mode: "freeform" | "columns";
  notes: Note[];
  columns: Column[];
  promoteTargets: PromoteTarget[];
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [mode, setMode] = useState(initialMode);
  const [save, setSave] = useState<SaveState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [promoting, setPromoting] = useState<string | null>(null);

  const signpostRef = useRef<HTMLDivElement>(null);
  const noteRefs = useRef(new Map<string, HTMLElement>());

  type Patch =
    | { move: string; x: number; y: number }
    | { edit: string; body: string }
    | { colour: string; color: number }
    | { lane: string; columnId: string | null }
    | { remove: string };

  const [notes, applyPatch] = useOptimistic(initialNotes, (current: Note[], patch: Patch) => {
    if ("remove" in patch) return current.filter((n) => n.id !== patch.remove);
    return current.map((n) => {
      if ("move" in patch && n.id === patch.move) return { ...n, pin_x: patch.x, pin_y: patch.y };
      if ("edit" in patch && n.id === patch.edit) return { ...n, body: patch.body };
      if ("colour" in patch && n.id === patch.colour) return { ...n, color: patch.color };
      if ("lane" in patch && n.id === patch.lane) return { ...n, column_id: patch.columnId };
      return n;
    });
  });

  function run(patch: Patch | null, action: () => Promise<{ ok: boolean; error?: string }>) {
    setSave("saving");
    setError(null);
    startTransition(async () => {
      if (patch) applyPatch(patch);
      const result = await action();
      setSave(result.ok ? "saved" : "error");
      if (!result.ok) setError(result.error ?? "That did not save.");
    });
  }

  function onAddNote() {
    // A pinned note lands with a small random tilt, as a real one would.
    const rotation = Math.round((Math.random() * 8 - 4) * 10) / 10;
    run(null, () =>
      addNote({
        buildingId,
        body: "",
        color: (notes.length % 6) + 1,
        // Lay new notes out on a grid wide enough that they do not overlap.
        pinX: 32 + (notes.length % 4) * 224,
        pinY: 24 + Math.floor(notes.length / 4) * 224,
        rotation,
        columnId: mode === "columns" ? (columns[0]?.id ?? null) : null,
      }),
    );
  }

  function onToggleMode() {
    const next = mode === "freeform" ? "columns" : "freeform";
    setMode(next);
    run(null, () => setBoardMode({ buildingId, mode: next }));
  }

  /** The ceremony: the note flies to the signpost, then the artifact is made. */
  async function onPromote(note: Note, target: { kind: "doc" } | { kind: "row" | "board"; targetBuildingId: string }) {
    const element = noteRefs.current.get(note.id);
    const signpost = signpostRef.current;

    setPromoting(note.id);
    if (element && signpost) await flyToSignpost(element, signpost);

    setSave("saving");
    startTransition(async () => {
      applyPatch({ remove: note.id });
      const result = await promoteNote({ buildingId, noteId: note.id, target });
      setPromoting(null);

      if (!result.ok) {
        setSave("error");
        setError(result.error);
        return;
      }

      setSave("saved");
      // Land the user in whatever the note became.
      router.push(`/b/${result.data.buildingId}`);
    });
  }

  const lanes = mode === "columns" ? columns : [];
  // Switching a freeform board to lanes leaves every note unsorted, so the
  // unsorted column is the important one and goes first.
  const unsorted = notes.filter((n) => !n.column_id);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={onAddNote}
          className="border-2 border-ink bg-amber px-2 py-1 font-pixel text-[10px] uppercase shadow-hard"
        >
          Pin a note
        </button>
        <button
          type="button"
          onClick={onToggleMode}
          aria-pressed={mode === "columns"}
          className="border-2 border-ink bg-paper px-2 py-1 font-pixel text-[10px] uppercase shadow-hard"
        >
          {mode === "freeform" ? "Freeform" : "Columns"}
        </button>
        <span className="font-pixel text-[10px] uppercase text-stone">{notes.length} notes</span>

        <div className="ml-auto flex items-center gap-3">
          <SaveIndicator state={save} />
          {/* The plaza signpost: promotion's destination, and the drop target. */}
          <div
            ref={signpostRef}
            aria-hidden
            className="border-2 border-ink bg-dust px-2 py-1 font-pixel text-[10px] uppercase shadow-hard"
          >
            ⌂ Signpost
          </div>
        </div>
      </div>

      {error ? (
        <p role="alert" className="border-2 border-brick bg-rose px-3 py-2 font-body text-sm">
          {error}
        </p>
      ) : null}

      {mode === "freeform" ? (
        <div
          className="relative min-h-[36rem] w-full overflow-hidden border-2 border-ink"
          style={{
            // Cork, drawn as a flat tone with a hard border. No gradients.
            backgroundColor: "var(--color-dust)",
          }}
        >
          {notes.map((note) => (
            <StickyNote
              key={note.id}
              note={note}
              registerRef={(el) => {
                if (el) noteRefs.current.set(note.id, el);
                else noteRefs.current.delete(note.id);
              }}
              dimmed={promoting !== null && promoting !== note.id}
              onMove={(x, y) => run({ move: note.id, x, y }, () => updateNote({ buildingId, noteId: note.id, pinX: x, pinY: y }))}
              onEdit={(body) => run({ edit: note.id, body }, () => updateNote({ buildingId, noteId: note.id, body }))}
              onColour={(color) => run({ colour: note.id, color }, () => updateNote({ buildingId, noteId: note.id, color }))}
              onDelete={() => run({ remove: note.id }, () => deleteNote({ buildingId, noteId: note.id }))}
              onPromote={(target) => void onPromote(note, target)}
              promoteTargets={promoteTargets}
            />
          ))}
          {notes.length === 0 ? (
            <p className="p-6 font-body text-sm text-ink">
              Nothing pinned yet. Pin a note and drag it anywhere.
            </p>
          ) : null}
        </div>
      ) : (
        <div className="flex items-start gap-3 overflow-x-auto pb-2">
          {unsorted.length > 0 ? (
            <UnsortedLane
              notes={unsorted}
              lanes={lanes}
              buildingId={buildingId}
              run={run}
              onPromote={(note, target) => void onPromote(note, target)}
              promoteTargets={promoteTargets}
            />
          ) : null}
          {lanes.map((lane) => (
            <section
              key={lane.id}
              aria-label={`${lane.name}, ${notes.filter((n) => n.column_id === lane.id).length} notes`}
              className="flex w-64 shrink-0 flex-col border-2 border-ink bg-snow"
            >
              <header className="border-b-2 border-ink px-2 py-1">
                <span
                  className="border-2 border-ink px-1 font-pixel text-[10px] uppercase"
                  style={{ backgroundColor: SWATCH[(lane.color - 1) % SWATCH.length] }}
                >
                  {lane.name}
                </span>
              </header>
              <div className="flex flex-col gap-2 p-2">
                {notes
                  .filter((n) => n.column_id === lane.id)
                  .map((note) => (
                    <LaneNote
                      key={note.id}
                      note={note}
                      lanes={lanes}
                      registerRef={(el) => {
                        if (el) noteRefs.current.set(note.id, el);
                        else noteRefs.current.delete(note.id);
                      }}
                      onEdit={(body) => run({ edit: note.id, body }, () => updateNote({ buildingId, noteId: note.id, body }))}
                      onLane={(columnId) =>
                        run({ lane: note.id, columnId }, () => updateNote({ buildingId, noteId: note.id, columnId }))
                      }
                      onDelete={() => run({ remove: note.id }, () => deleteNote({ buildingId, noteId: note.id }))}
                      onPromote={(target) => void onPromote(note, target)}
                      promoteTargets={promoteTargets}
                    />
                  ))}
              </div>
            </section>
          ))}

        </div>
      )}
    </div>
  );
}

type PromoteHandler = (target: { kind: "doc" } | { kind: "row" | "board"; targetBuildingId: string }) => void;

/** Freeform note: absolutely pinned, draggable, tilted. */
function StickyNote({
  note,
  registerRef,
  dimmed,
  onMove,
  onEdit,
  onColour,
  onDelete,
  onPromote,
  promoteTargets,
}: {
  note: Note;
  registerRef: (el: HTMLElement | null) => void;
  dimmed: boolean;
  onMove: (x: number, y: number) => void;
  onEdit: (body: string) => void;
  onColour: (color: number) => void;
  onDelete: () => void;
  onPromote: PromoteHandler;
  promoteTargets: PromoteTarget[];
}) {
  const elementRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ id: number; startX: number; startY: number; originX: number; originY: number } | null>(null);
  const [position, setPosition] = useState({ x: note.pin_x, y: note.pin_y });

  // The pin-down animation is a side effect, so it belongs in an effect --
  // not in render, where it would fire on every pass and fight React.
  useEffect(() => {
    if (elementRef.current) pinDown(elementRef.current, note.rotation);
    // Runs once per mounted note: pinning is what mounting represents.
  }, [note.rotation]);

  return (
    <div
      ref={(el) => {
        elementRef.current = el;
        registerRef(el);
      }}
      className="absolute cursor-grab border-2 border-ink p-2 shadow-hard active:cursor-grabbing"
      style={{
        left: Math.round(position.x),
        top: Math.round(position.y),
        width: NOTE_W,
        minHeight: NOTE_H,
        backgroundColor: SWATCH[(note.color - 1) % SWATCH.length],
        transform: `rotate(${note.rotation}deg)`,
        opacity: dimmed ? 0.4 : 1,
        touchAction: "none",
      }}
      // Cursor state is CSS: reading the drag ref during render would never
      // re-render, so the cursor would never actually change.
      onPointerDown={(event) => {
        if ((event.target as HTMLElement).closest("button, textarea, select")) return;
        drag.current = {
          id: event.pointerId,
          startX: event.clientX,
          startY: event.clientY,
          originX: position.x,
          originY: position.y,
        };
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        const d = drag.current;
        if (!d || d.id !== event.pointerId) return;
        setPosition({
          x: Math.max(0, Math.round(d.originX + event.clientX - d.startX)),
          y: Math.max(0, Math.round(d.originY + event.clientY - d.startY)),
        });
      }}
      onPointerUp={(event) => {
        const d = drag.current;
        if (!d || d.id !== event.pointerId) return;
        drag.current = null;
        if (position.x !== note.pin_x || position.y !== note.pin_y) onMove(position.x, position.y);
      }}
    >
      <NoteBody note={note} onEdit={onEdit} />
      <NoteActions
        note={note}
        onColour={onColour}
        onDelete={onDelete}
        onPromote={onPromote}
        promoteTargets={promoteTargets}
      />
    </div>
  );
}

/** Column-mode note: no absolute position, moved between lanes by a select. */
function LaneNote({
  note,
  lanes,
  registerRef,
  onEdit,
  onLane,
  onDelete,
  onPromote,
  promoteTargets,
}: {
  note: Note;
  lanes: Column[];
  registerRef: (el: HTMLElement | null) => void;
  onEdit: (body: string) => void;
  onLane: (columnId: string | null) => void;
  onDelete: () => void;
  onPromote: PromoteHandler;
  promoteTargets: PromoteTarget[];
}) {
  return (
    <div
      ref={registerRef}
      className="border-2 border-ink p-2 shadow-hard"
      style={{ backgroundColor: SWATCH[(note.color - 1) % SWATCH.length] }}
    >
      <NoteBody note={note} onEdit={onEdit} />
      <div className="mt-2 flex items-center gap-1">
        <label className="sr-only" htmlFor={`lane-${note.id}`}>
          Move to lane
        </label>
        <select
          id={`lane-${note.id}`}
          value={note.column_id ?? ""}
          onChange={(e) => onLane(e.target.value || null)}
          className="border-2 border-ink bg-paper px-1 font-pixel text-[10px] uppercase"
        >
          <option value="">Unsorted</option>
          {lanes.map((lane) => (
            <option key={lane.id} value={lane.id}>
              {lane.name}
            </option>
          ))}
        </select>
        <NoteActions
          note={note}
          onDelete={onDelete}
          onPromote={onPromote}
          promoteTargets={promoteTargets}
        />
      </div>
    </div>
  );
}

function NoteBody({ note, onEdit }: { note: Note; onEdit: (body: string) => void }) {
  const [draft, setDraft] = useState(note.body);

  return (
    <textarea
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        if (draft !== note.body) onEdit(draft);
      }}
      rows={3}
      aria-label="Note text"
      placeholder="Write something…"
      className="w-full resize-none border-0 bg-transparent font-body text-sm text-ink outline-none"
    />
  );
}

function NoteActions({
  note,
  onColour,
  onDelete,
  onPromote,
  promoteTargets,
}: {
  note: Note;
  onColour?: (color: number) => void;
  onDelete: () => void;
  onPromote: PromoteHandler;
  promoteTargets: PromoteTarget[];
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="mt-1 flex flex-col gap-1">
      {/* Swatches and buttons on separate rows: together they are wider than
          a note, and the sixth swatch used to spill past the border. */}
      {onColour ? (
        <div className="flex gap-0.5" role="group" aria-label="Note colour">
          {SWATCH.map((swatch, i) => (
            <button
              key={i}
              type="button"
              aria-label={`Colour ${i + 1}`}
              aria-pressed={note.color === i + 1}
              onClick={() => onColour(i + 1)}
              className="h-3 w-3 border border-ink"
              style={{ backgroundColor: swatch }}
            />
          ))}
        </div>
      ) : null}

      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="border-2 border-ink bg-paper px-1 font-pixel text-[10px] uppercase"
        >
          Promote
        </button>
        <button
          type="button"
          onClick={onDelete}
          aria-label="Remove note"
          className="ml-auto border-2 border-ink bg-paper px-1 font-pixel text-[10px] uppercase"
        >
          ✕
        </button>
      </div>

      {open ? (
        <div className="mt-1 flex w-full flex-col gap-1 border-2 border-ink bg-paper p-1">
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              onPromote({ kind: "doc" });
            }}
            className="border-2 border-ink bg-snow px-1 py-0.5 text-left font-pixel text-[10px] uppercase"
          >
            ▤ Build a library
          </button>
          {promoteTargets
            .filter((t) => t.artifactType === "table")
            .map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => {
                  setOpen(false);
                  onPromote({ kind: "row", targetBuildingId: t.id });
                }}
                className="border-2 border-ink bg-snow px-1 py-0.5 text-left font-pixel text-[10px] uppercase"
              >
                ▦ Row in {t.title}
              </button>
            ))}
          {promoteTargets
            .filter((t) => t.artifactType === "board" && t.id !== note.building_id)
            .map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => {
                  setOpen(false);
                  onPromote({ kind: "board", targetBuildingId: t.id });
                }}
                className="border-2 border-ink bg-snow px-1 py-0.5 text-left font-pixel text-[10px] uppercase"
              >
                ▣ Move to {t.title}
              </button>
            ))}
        </div>
      ) : null}
    </div>
  );
}

/** The inbox lane: notes that have not been filed into a column yet. */
function UnsortedLane({
  notes,
  lanes,
  buildingId,
  run,
  onPromote,
  promoteTargets,
}: {
  notes: Note[];
  lanes: Column[];
  buildingId: string;
  run: (patch: null, action: () => Promise<{ ok: boolean; error?: string }>) => void;
  onPromote: (note: Note, target: { kind: "doc" } | { kind: "row" | "board"; targetBuildingId: string }) => void;
  promoteTargets: PromoteTarget[];
}) {
  return (
    <section
      aria-label={`Unsorted, ${notes.length} notes`}
      className="flex w-64 shrink-0 flex-col border-2 border-ink bg-paper"
    >
      <header className="border-b-2 border-ink px-2 py-1 font-pixel text-[10px] uppercase text-stone">
        Unsorted
      </header>
      <div className="flex flex-col gap-2 p-2">
        {notes.map((note) => (
          <LaneNote
            key={note.id}
            note={note}
            lanes={lanes}
            registerRef={() => {}}
            onEdit={(body) => run(null, () => updateNote({ buildingId, noteId: note.id, body }))}
            onLane={(columnId) => run(null, () => updateNote({ buildingId, noteId: note.id, columnId }))}
            onDelete={() => run(null, () => deleteNote({ buildingId, noteId: note.id }))}
            onPromote={(target) => onPromote(note, target)}
            promoteTargets={promoteTargets}
          />
        ))}
      </div>
    </section>
  );
}
