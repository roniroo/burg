"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useReducedMotion } from "@/lib/use-reduced-motion";
import {
  TILE_H,
  TILE_W,
  depthFor,
  isInRegion,
  snap,
  stepZoom,
  tileToScreen,
  visibleTileRange,
  worldBounds,
  type Zoom,
} from "@/lib/iso";
import {
  SPRITE_FOR_TYPE,
  TERRAIN_FILL,
  TILE_DIAMOND,
  buildingSprite,
  type SpriteKey,
  type SpriteVariant,
} from "@/lib/sprites";
import { BUILDING_NOUN } from "@/lib/artifacts";
import { Sprite } from "./sprite";
import type { MapBuilding, MapNeighborhood, MapTile } from "./types";

type Props = {
  cityWidth: number;
  cityHeight: number;
  neighborhoods: MapNeighborhood[];
  buildings: MapBuilding[];
  tiles: MapTile[];
};

type Camera = { x: number; y: number; zoom: Zoom };

/**
 * The city map: a DOM-rendered isometric grid.
 *
 * DOM rather than canvas so every building stays a real, focusable <button>
 * that a screen reader can reach and motion can animate. A personal city is a
 * few hundred tiles, not a few thousand, and offscreen tiles are culled.
 */
export function CityMap({ cityWidth, cityHeight, neighborhoods, buildings, tiles }: Props) {
  const router = useRouter();
  const reduceMotion = useReducedMotion();
  const viewportRef = useRef<HTMLDivElement>(null);

  const [camera, setCamera] = useState<Camera>({ x: 0, y: 0, zoom: 1 });
  const [size, setSize] = useState({ width: 1024, height: 640 });
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);
  const [entering, setEntering] = useState<string | null>(null);

  /**
   * Frame the inhabited part of the city, not the whole grid. A 40x40 map is
   * mostly empty ground; centring on its geometric middle puts the districts
   * off in the corners.
   */
  const bounds = useMemo(() => {
    if (neighborhoods.length === 0) return worldBounds(cityWidth, cityHeight);

    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;

    for (const n of neighborhoods) {
      for (const [tx, ty] of [
        [n.origin_x, n.origin_y],
        [n.origin_x + n.width, n.origin_y],
        [n.origin_x, n.origin_y + n.height],
        [n.origin_x + n.width, n.origin_y + n.height],
      ] as const) {
        const p = tileToScreen(tx, ty);
        minX = Math.min(minX, p.x - TILE_W / 2);
        maxX = Math.max(maxX, p.x + TILE_W / 2);
        minY = Math.min(minY, p.y);
        maxY = Math.max(maxY, p.y + TILE_H);
      }
    }
    return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
  }, [neighborhoods, cityWidth, cityHeight]);

  // Centre the city on first paint.
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    setSize({ width: rect.width, height: rect.height });
    setCamera((c) => ({
      ...c,
      x: snap(rect.width / 2 - (bounds.x + bounds.width / 2)),
      y: snap(rect.height / 2 - (bounds.y + bounds.height / 2)),
    }));
  }, [bounds]);

  useEffect(() => {
    const el = viewportRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setSize({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // --- culling ------------------------------------------------------------
  // Convert the viewport rectangle into world space, then into a tile range.
  const viewportWorld = useMemo(
    () => ({
      x: -camera.x / camera.zoom,
      y: -camera.y / camera.zoom,
      width: size.width / camera.zoom,
      height: size.height / camera.zoom,
    }),
    [camera, size],
  );

  const range = useMemo(
    () => visibleTileRange(viewportWorld, cityWidth, cityHeight),
    [viewportWorld, cityWidth, cityHeight],
  );

  const tileByKey = useMemo(() => {
    const map = new Map<string, MapTile>();
    for (const t of tiles) map.set(`${t.x},${t.y}`, t);
    return map;
  }, [tiles]);

  const hoodById = useMemo(
    () => new Map(neighborhoods.map((n) => [n.id, n])),
    [neighborhoods],
  );

  /** Which neighbourhood, if any, owns a tile -- decides its biome tinting. */
  const hoodAt = useCallback(
    (x: number, y: number) => neighborhoods.find((n) => isInRegion(x, y, n)) ?? null,
    [neighborhoods],
  );

  const visibleTiles = useMemo(() => {
    const out: Array<{ x: number; y: number; tile: MapTile | undefined; hood: MapNeighborhood | null }> = [];
    for (let x = range.minX; x <= range.maxX; x++) {
      for (let y = range.minY; y <= range.maxY; y++) {
        out.push({ x, y, tile: tileByKey.get(`${x},${y}`), hood: hoodAt(x, y) });
      }
    }
    return out;
  }, [range, tileByKey, hoodAt]);

  const visibleBuildings = useMemo(
    () =>
      buildings.filter(
        (b) =>
          b.tile_x + b.footprint_w - 1 >= range.minX - 2 &&
          b.tile_x <= range.maxX + 2 &&
          b.tile_y + b.footprint_h - 1 >= range.minY - 2 &&
          b.tile_y <= range.maxY + 2,
      ),
    [buildings, range],
  );

  // --- camera controls ----------------------------------------------------
  const dragState = useRef<{ pointerId: number; startX: number; startY: number; camX: number; camY: number } | null>(null);

  function onPointerDown(event: React.PointerEvent<HTMLDivElement>) {
    // Only the background pans; clicks on buildings must still register.
    if ((event.target as HTMLElement).closest("[data-building]")) return;
    dragState.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      camX: camera.x,
      camY: camera.y,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function onPointerMove(event: React.PointerEvent<HTMLDivElement>) {
    const drag = dragState.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    setCamera((c) => ({
      ...c,
      // Rounded here so the transform never lands on a half pixel.
      x: snap(drag.camX + (event.clientX - drag.startX)),
      y: snap(drag.camY + (event.clientY - drag.startY)),
    }));
  }

  function endDrag(event: React.PointerEvent<HTMLDivElement>) {
    if (dragState.current?.pointerId === event.pointerId) dragState.current = null;
  }

  function onWheel(event: React.WheelEvent<HTMLDivElement>) {
    if (Math.abs(event.deltaY) < 2) return;
    setCamera((c) => {
      const next = stepZoom(c.zoom, event.deltaY < 0 ? 1 : -1);
      if (next === c.zoom) return c;
      // Keep the point under the cursor fixed across the zoom step.
      const rect = viewportRef.current?.getBoundingClientRect();
      const px = rect ? event.clientX - rect.left : size.width / 2;
      const py = rect ? event.clientY - rect.top : size.height / 2;
      const ratio = next / c.zoom;
      return {
        zoom: next,
        x: snap(px - (px - c.x) * ratio),
        y: snap(py - (py - c.y) * ratio),
      };
    });
  }

  // --- keyboard navigation ------------------------------------------------
  // Arrow keys move a tile cursor along SCREEN axes, which in isometric space
  // means moving diagonally through the grid.
  const SCREEN_AXES: Record<string, { dx: number; dy: number }> = useMemo(
    () => ({
      ArrowUp: { dx: -1, dy: -1 },
      ArrowDown: { dx: 1, dy: 1 },
      ArrowLeft: { dx: -1, dy: 1 },
      ArrowRight: { dx: 1, dy: -1 },
    }),
    [],
  );

  const buildingAt = useCallback(
    (x: number, y: number) =>
      buildings.find(
        (b) =>
          x >= b.tile_x &&
          x < b.tile_x + b.footprint_w &&
          y >= b.tile_y &&
          y < b.tile_y + b.footprint_h,
      ) ?? null,
    [buildings],
  );

  /**
   * Move the tile cursor and pan to keep it on screen, both in the same
   * interaction. Doing the pan here rather than in an effect that watches
   * `cursor` avoids a second render pass per keystroke.
   */
  function moveCursor(axis: { dx: number; dy: number }) {
    const from = cursor ?? { x: Math.floor(cityWidth / 2), y: Math.floor(cityHeight / 2) };
    const next = {
      x: Math.min(cityWidth - 1, Math.max(0, from.x + axis.dx)),
      y: Math.min(cityHeight - 1, Math.max(0, from.y + axis.dy)),
    };
    setCursor(next);

    const screen = tileToScreen(next.x, next.y);
    setCamera((c) => {
      const px = screen.x * c.zoom + c.x;
      const py = screen.y * c.zoom + c.y;
      const pad = 96;
      let { x, y } = c;
      if (px < pad) x = snap(c.x + (pad - px));
      if (px > size.width - pad) x = snap(c.x - (px - (size.width - pad)));
      if (py < pad) y = snap(c.y + (pad - py));
      if (py > size.height - pad) y = snap(c.y - (py - (size.height - pad)));
      return x === c.x && y === c.y ? c : { ...c, x, y };
    });
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    const axis = SCREEN_AXES[event.key];
    if (axis) {
      event.preventDefault();
      moveCursor(axis);
      return;
    }

    if ((event.key === "Enter" || event.key === " ") && cursor) {
      const building = buildingAt(cursor.x, cursor.y);
      if (building) {
        event.preventDefault();
        enterBuilding(building.id);
      }
      return;
    }

    if (event.key === "+" || event.key === "=") {
      setCamera((c) => ({ ...c, zoom: stepZoom(c.zoom, 1) }));
    } else if (event.key === "-") {
      setCamera((c) => ({ ...c, zoom: stepZoom(c.zoom, -1) }));
    }
  }

  /**
   * Squash, then hand off to the interior. Under reduced motion this is an
   * instant cut -- no squash, no wipe.
   */
  const enterBuilding = useCallback(
    (id: string) => {
      if (reduceMotion) {
        router.push(`/b/${id}`);
        return;
      }
      setEntering(id);
      window.setTimeout(() => router.push(`/b/${id}`), 260);
    },
    [reduceMotion, router],
  );

  return (
    <div
      ref={viewportRef}
      role="application"
      aria-label="City map. Arrow keys move between tiles, Enter opens a building, plus and minus zoom."
      tabIndex={0}
      onKeyDown={onKeyDown}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onWheel={onWheel}
      className="relative h-full w-full cursor-grab touch-none overflow-hidden bg-sky select-none active:cursor-grabbing"
    >
      {/* The world. One transform for the whole map, snapped to whole pixels. */}
      <div
        className="absolute left-0 top-0 origin-top-left"
        style={{
          transform: `translate(${snap(camera.x)}px, ${snap(camera.y)}px) scale(${camera.zoom})`,
          transition: reduceMotion ? "none" : "transform 160ms steps(4, end)",
        }}
      >
        {/* Ground */}
        {visibleTiles.map(({ x, y, tile, hood }) => {
          const screen = tileToScreen(x, y);
          const terrain = tile?.terrain ?? "grass";
          const isCursor = cursor?.x === x && cursor?.y === y;
          return (
            <div
              key={`t-${x}-${y}`}
              data-biome={hood?.biome}
              data-status={hood?.status}
              className="absolute"
              style={{
                left: snap(screen.x - TILE_W / 2),
                top: snap(screen.y),
                width: TILE_W,
                height: TILE_H,
                zIndex: x + y,
              }}
            >
              <svg width={TILE_W} height={TILE_H} className="pixelated block" shapeRendering="crispEdges" aria-hidden>
                <polygon
                  points={TILE_DIAMOND}
                  fill={TERRAIN_FILL[terrain]}
                  stroke={isCursor ? "var(--color-gold)" : "var(--color-ink)"}
                  strokeWidth={isCursor ? 2 : 0.5}
                  strokeOpacity={isCursor ? 1 : 0.25}
                />
              </svg>
            </div>
          );
        })}

        {/* Buildings */}
        {visibleBuildings.map((b) => {
          const hood = hoodById.get(b.neighborhood_id) ?? null;
          const screen = tileToScreen(b.tile_x, b.tile_y);
          const key = (b.sprite_key as SpriteKey) in SPRITE_FOR_TYPE_VALUES
            ? (b.sprite_key as SpriteKey)
            : SPRITE_FOR_TYPE[b.artifact_type];
          const geometry = buildingSprite(
            key,
            (b.sprite_variant as SpriteVariant) ?? 1,
            b.footprint_w,
            b.footprint_h,
            b.floors,
          );
          const isEntering = entering === b.id;

          return (
            <button
              key={b.id}
              data-building={b.id}
              data-biome={hood?.biome}
              data-status={hood?.status}
              type="button"
              onClick={() => enterBuilding(b.id)}
              onFocus={() => setCursor({ x: b.tile_x, y: b.tile_y })}
              aria-label={`${BUILDING_NOUN[b.artifact_type]}: ${b.title}${hood ? `, in ${hood.name}` : ""}`}
              className="group absolute block border-0 bg-transparent p-0"
              style={{
                left: snap(screen.x - geometry.originX),
                top: snap(screen.y - geometry.originY),
                width: geometry.width,
                height: geometry.height,
                zIndex: depthFor(b.tile_x, b.tile_y, b.footprint_w, b.footprint_h) + 1,
                transform: isEntering ? "translateY(2px) scaleY(0.92)" : undefined,
                transition: reduceMotion ? "none" : "transform 120ms steps(3, end)",
              }}
            >
              <span className="block transition-transform duration-150 group-hover:-translate-y-0.5 group-focus-visible:-translate-y-0.5">
                <Sprite geometry={geometry} />
              </span>
              <span className="pointer-events-none absolute left-1/2 top-0 hidden -translate-x-1/2 -translate-y-full whitespace-nowrap border-2 border-ink bg-paper px-1 font-pixel text-[10px] uppercase text-ink shadow-hard group-hover:block group-focus-visible:block">
                {b.title}
              </span>
            </button>
          );
        })}
      </div>

      {/* Zoom readout / controls */}
      <div className="pointer-events-none absolute bottom-3 right-3 border-2 border-ink bg-paper px-2 py-1 font-pixel text-[10px] uppercase text-ink shadow-hard">
        {camera.zoom}×
      </div>
    </div>
  );
}

/** Guard for sprite_key values coming from the database. */
const SPRITE_FOR_TYPE_VALUES: Record<SpriteKey, true> = {
  library: true,
  warehouse: true,
  noticeboard: true,
  newsstand: true,
  studio: true,
  hoarding: true,
};
