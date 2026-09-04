"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  GRID,
  boundsOf,
  createNode,
  hitTest,
  snapToGrid,
  type NodeKind,
  type Scene,
} from "@/lib/canvas/model";
import { saveScene } from "@/lib/actions/canvas";
import { SWATCH } from "./table-cell";
import { SaveIndicator, type SaveState } from "./save-indicator";

const TOOLS: Array<{ kind: NodeKind | "select"; label: string; glyph: string }> = [
  { kind: "select", label: "Select", glyph: "⌖" },
  { kind: "sticky", label: "Sticky", glyph: "▢" },
  { kind: "rect", label: "Rectangle", glyph: "▭" },
  { kind: "ellipse", label: "Ellipse", glyph: "◯" },
  { kind: "line", label: "Line", glyph: "╱" },
  { kind: "pen", label: "Pen", glyph: "✎" },
];

const AUTOSAVE_MS = 800;
const BOARD = 4000;

/**
 * The Studio.
 *
 * Deliberately small: five things to draw, an 8px grid, no layers panel. It is
 * a place to sketch a shape of an idea, not a design tool -- anything more
 * would be a worse copy of something that already exists.
 */
export function Studio({ buildingId, initialScene }: { buildingId: string; initialScene: Scene }) {
  const [scene, setScene] = useState<Scene>(initialScene);
  const [tool, setTool] = useState<NodeKind | "select">("select");
  const [colour, setColour] = useState(1);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [save, setSave] = useState<SaveState>("idle");

  const surfaceRef = useRef<HTMLDivElement>(null);
  const drag = useRef<
    | { mode: "pan"; startX: number; startY: number; vx: number; vy: number }
    | { mode: "move"; id: string; startX: number; startY: number; ox: number; oy: number }
    | { mode: "draw"; id: string; startX: number; startY: number }
    | null
  >(null);

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = useRef<Scene | null>(null);

  const flush = useCallback(async () => {
    const next = pending.current;
    if (!next) return;
    pending.current = null;
    setSave("saving");
    const result = await saveScene({ buildingId, scene: next });
    setSave(result.ok ? "saved" : "error");
  }, [buildingId]);

  const commit = useCallback(
    (next: Scene) => {
      setScene(next);
      pending.current = next;
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => void flush(), AUTOSAVE_MS);
    },
    [flush],
  );

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
      if (pending.current) void flush();
    };
  }, [flush]);

  /** Screen point -> board coordinates, undoing pan and zoom. */
  const toBoard = useCallback(
    (clientX: number, clientY: number) => {
      const rect = surfaceRef.current?.getBoundingClientRect();
      if (!rect) return { x: 0, y: 0 };
      const { x, y, zoom } = scene.viewport;
      return { x: (clientX - rect.left - x) / zoom, y: (clientY - rect.top - y) / zoom };
    },
    [scene.viewport],
  );

  function onPointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if ((event.target as HTMLElement).closest("textarea, button, input")) return;
    const point = toBoard(event.clientX, event.clientY);
    event.currentTarget.setPointerCapture(event.pointerId);

    if (tool === "select") {
      const hit = hitTest(scene, point.x, point.y);
      if (hit) {
        setSelectedId(hit.id);
        drag.current = { mode: "move", id: hit.id, startX: point.x, startY: point.y, ox: hit.x, oy: hit.y };
      } else {
        setSelectedId(null);
        drag.current = {
          mode: "pan",
          startX: event.clientX,
          startY: event.clientY,
          vx: scene.viewport.x,
          vy: scene.viewport.y,
        };
      }
      return;
    }

    const node = createNode(tool, point.x, point.y, colour);
    commit({ ...scene, nodes: [...scene.nodes, node] });
    setSelectedId(node.id);
    drag.current = { mode: "draw", id: node.id, startX: point.x, startY: point.y };
  }

  function onPointerMove(event: React.PointerEvent<HTMLDivElement>) {
    const state = drag.current;
    if (!state) return;
    const point = toBoard(event.clientX, event.clientY);

    if (state.mode === "pan") {
      setScene((current) => ({
        ...current,
        viewport: {
          ...current.viewport,
          x: Math.round(state.vx + event.clientX - state.startX),
          y: Math.round(state.vy + event.clientY - state.startY),
        },
      }));
      return;
    }

    if (state.mode === "move") {
      setScene((current) => ({
        ...current,
        nodes: current.nodes.map((n) =>
          n.id === state.id
            ? { ...n, x: snapToGrid(state.ox + point.x - state.startX), y: snapToGrid(state.oy + point.y - state.startY) }
            : n,
        ),
      }));
      return;
    }

    // Drawing: boxes and lines size from the anchor; the pen collects points.
    setScene((current) => ({
      ...current,
      nodes: current.nodes.map((n) => {
        if (n.id !== state.id) return n;
        if (n.kind === "pen") {
          return { ...n, points: [...(n.points ?? []), { x: point.x - n.x, y: point.y - n.y }] };
        }
        return { ...n, w: snapToGrid(point.x - n.x), h: snapToGrid(point.y - n.y) };
      }),
    }));
  }

  function onPointerUp() {
    if (drag.current && drag.current.mode !== "pan") {
      commit(scene);
    } else if (drag.current?.mode === "pan") {
      commit(scene);
    }
    drag.current = null;
  }

  function onWheel(event: React.WheelEvent<HTMLDivElement>) {
    const next = Math.min(3, Math.max(0.5, scene.viewport.zoom + (event.deltaY < 0 ? 0.25 : -0.25)));
    if (next === scene.viewport.zoom) return;
    commit({ ...scene, viewport: { ...scene.viewport, zoom: next } });
  }

  const removeSelected = useCallback(() => {
    if (!selectedId) return;
    commit({ ...scene, nodes: scene.nodes.filter((n) => n.id !== selectedId) });
    setSelectedId(null);
  }, [selectedId, scene, commit]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.key === "Delete" || event.key === "Backspace") && selectedId) {
        const target = event.target as HTMLElement;
        if (target.tagName === "TEXTAREA" || target.tagName === "INPUT") return;
        event.preventDefault();
        removeSelected();
      }
      if (event.key === "Escape") setSelectedId(null);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [selectedId, removeSelected]);

  const strokes = scene.nodes.filter((n) => n.kind === "line" || n.kind === "pen");
  const boxes = scene.nodes.filter((n) => n.kind !== "line" && n.kind !== "pen");

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <div role="radiogroup" aria-label="Tool" className="flex gap-1">
          {TOOLS.map((entry) => (
            <button
              key={entry.kind}
              type="button"
              role="radio"
              aria-checked={tool === entry.kind}
              onClick={() => setTool(entry.kind)}
              className="border-2 border-ink px-2 py-1 font-pixel text-[10px] uppercase shadow-hard"
              style={{ backgroundColor: tool === entry.kind ? "var(--color-gold)" : "var(--color-snow)" }}
            >
              <span aria-hidden className="mr-1">
                {entry.glyph}
              </span>
              {entry.label}
            </button>
          ))}
        </div>

        <div role="group" aria-label="Colour" className="flex gap-0.5">
          {SWATCH.map((swatch, i) => (
            <button
              key={i}
              type="button"
              aria-label={`Colour ${i + 1}`}
              aria-pressed={colour === i + 1}
              onClick={() => setColour(i + 1)}
              className="h-5 w-5 border-2 border-ink"
              style={{ backgroundColor: swatch, outline: colour === i + 1 ? "2px solid var(--color-ink)" : undefined }}
            />
          ))}
        </div>

        <button
          type="button"
          onClick={removeSelected}
          disabled={!selectedId}
          className="border-2 border-ink bg-paper px-2 py-1 font-pixel text-[10px] uppercase shadow-hard disabled:opacity-40"
        >
          Delete
        </button>

        <span className="font-pixel text-[10px] uppercase text-stone">
          {Math.round(scene.viewport.zoom * 100)}%
        </span>

        <div className="ml-auto">
          <SaveIndicator state={save} />
        </div>
      </div>

      <div
        ref={surfaceRef}
        data-studio
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onWheel={onWheel}
        className="relative h-[32rem] w-full touch-none overflow-hidden border-2 border-ink bg-snow"
        style={{
          // The 8px grid, drawn rather than implied.
          backgroundImage:
            "repeating-linear-gradient(to right, var(--color-mist) 0 1px, transparent 1px 8px), repeating-linear-gradient(to bottom, var(--color-mist) 0 1px, transparent 1px 8px)",
          cursor: tool === "select" ? "grab" : "crosshair",
        }}
      >
        <div
          className="absolute left-0 top-0 origin-top-left"
          style={{
            transform: `translate(${Math.round(scene.viewport.x)}px, ${Math.round(scene.viewport.y)}px) scale(${scene.viewport.zoom})`,
            width: BOARD,
            height: BOARD,
          }}
        >
          {/* Lines and freehand, in one SVG behind the boxes. */}
          <svg
            width={BOARD}
            height={BOARD}
            className="pointer-events-none absolute left-0 top-0"
            shapeRendering="crispEdges"
            aria-hidden
          >
            {strokes.map((n) => {
              const stroke = SWATCH[(n.color - 1) % SWATCH.length];
              if (n.kind === "line") {
                return (
                  <line
                    key={n.id}
                    x1={n.x}
                    y1={n.y}
                    x2={n.x + n.w}
                    y2={n.y + n.h}
                    stroke="var(--color-ink)"
                    strokeWidth={selectedId === n.id ? 4 : 2}
                  />
                );
              }
              const points = (n.points ?? []).map((p) => `${n.x + p.x},${n.y + p.y}`).join(" ");
              return (
                <polyline
                  key={n.id}
                  points={points}
                  fill="none"
                  stroke={stroke}
                  strokeWidth={selectedId === n.id ? 5 : 3}
                />
              );
            })}
          </svg>

          {boxes.map((node) => {
            const b = boundsOf(node);
            const selected = selectedId === node.id;
            return (
              <div
                key={node.id}
                className="absolute border-2 border-ink"
                style={{
                  left: b.x,
                  top: b.y,
                  width: Math.max(GRID, b.w),
                  height: Math.max(GRID, b.h),
                  backgroundColor:
                    node.kind === "ellipse" || node.kind === "rect" || node.kind === "sticky"
                      ? SWATCH[(node.color - 1) % SWATCH.length]
                      : "transparent",
                  borderRadius: node.kind === "ellipse" ? "50%" : undefined,
                  boxShadow: selected ? "0 0 0 2px var(--color-gold)" : "2px 2px 0 0 var(--color-ink)",
                }}
              >
                {node.kind === "sticky" ? (
                  <textarea
                    value={node.text ?? ""}
                    aria-label="Sticky text"
                    onChange={(e) =>
                      commit({
                        ...scene,
                        nodes: scene.nodes.map((n) => (n.id === node.id ? { ...n, text: e.target.value } : n)),
                      })
                    }
                    className="h-full w-full resize-none border-0 bg-transparent p-1 font-body text-xs text-ink outline-none"
                  />
                ) : null}
              </div>
            );
          })}
        </div>
      </div>

      <p className="font-body text-xs text-stone">
        Pick a tool and drag on the board. Select and drag to move, Delete to remove, scroll to zoom.
        Everything snaps to the {GRID}px grid.
      </p>
    </div>
  );
}
