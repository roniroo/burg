"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useReducedMotion } from "@/lib/use-reduced-motion";
import {
  TILE_H,
  TILE_W,
  depthFor,
  isInRegion,
  screenToTile,
  snap,
  stepZoom,
  tileToScreen,
  visibleTileRange,
  worldBounds,
  type Zoom,
} from "@/lib/iso";
import { canPlace, REJECTION_MESSAGE, type Terrain } from "@/lib/placement";
import {
  createBuilding,
  createNeighborhood,
  deleteBuilding,
  deleteNeighborhood,
} from "@/lib/actions/city";
import { BuildBar, type BuildDraft } from "./build-bar";
import { DemolishBar, type DemolishTarget } from "./demolish-bar";
import { RoadLayer, type MapRoute } from "./road-layer";
import { ConnectionsPanel, type RouteLink } from "./connections-panel";
import { solveStaleRoutes } from "@/lib/actions/roads";
import { raiseBuilding } from "@/lib/anim";
import { AmbientLayer, useDaylight } from "./ambient";
import { Ticker, type Headline } from "./ticker";
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
  cityId: string;
  cityWidth: number;
  cityHeight: number;
  neighborhoods: MapNeighborhood[];
  buildings: MapBuilding[];
  tiles: MapTile[];
  routes: MapRoute[];
  routeLinks: Record<string, RouteLink[]>;
  staleRoutes: number;
  headlines: Headline[];
};

type Camera = { x: number; y: number; zoom: Zoom };

/** What demolish mode has picked out. Resolved to a bar target on render. */
type Condemned = { kind: "building" | "district"; id: string };

/**
 * The city map: a DOM-rendered isometric grid.
 *
 * DOM rather than canvas so every building stays a real, focusable <button>
 * that a screen reader can reach and motion can animate. A personal city is a
 * few hundred tiles, not a few thousand, and offscreen tiles are culled.
 */
export function CityMap({
  cityId,
  cityWidth,
  cityHeight,
  neighborhoods,
  buildings,
  tiles,
  routes,
  routeLinks,
  staleRoutes,
  headlines,
}: Props) {
  const light = useDaylight();
  const router = useRouter();
  const reduceMotion = useReducedMotion();
  const viewportRef = useRef<HTMLDivElement>(null);

  const [camera, setCamera] = useState<Camera>({ x: 0, y: 0, zoom: 1 });
  const [size, setSize] = useState({ width: 1024, height: 640 });
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);
  const [entering, setEntering] = useState<string | null>(null);

  // Build mode. Null when not building.
  const [draft, setDraft] = useState<BuildDraft | null>(null);
  const [ghost, setGhost] = useState<{ x: number; y: number } | null>(null);
  const [buildHint, setBuildHint] = useState<string | null>(null);
  const [raising, setRaising] = useState<{ x: number; y: number } | null>(null);

  // Demolish mode. Clicking on the map only ever condemns -- a building if
  // one was clicked, otherwise the district whose ground was -- and the bar
  // is the only thing that actually takes anything down.
  const [demolishing, setDemolishing] = useState(false);
  const [condemned, setCondemned] = useState<Condemned | null>(null);
  const [demolishHint, setDemolishHint] = useState<string | null>(null);
  const [razing, setRazing] = useState(false);

  // Roads
  const [hoveredRoad, setHoveredRoad] = useState<string | null>(null);
  const [selectedRoad, setSelectedRoad] = useState<string | null>(null);
  const [pavingIds, setPavingIds] = useState<string[]>([]);
  const solving = useRef(false);

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

  /**
   * Drain any stale routes.
   *
   * The database only ever flags a route as needing a re-solve; the A* runs in
   * app code. Doing it here means a link created anywhere -- a wiki link, a
   * table relation, a promoted note -- shows up as a road the next time the
   * map is opened.
   */
  useEffect(() => {
    if (staleRoutes === 0 || solving.current) return;
    solving.current = true;
    void solveStaleRoutes({ cityId }).then((result) => {
      solving.current = false;
      if (!result.ok) return;
      // Remembered across the refresh so the new roads pave themselves in
      // once their tiles actually exist.
      if (result.solvedIds.length > 0) setPavingIds(result.solvedIds);
      if (result.solved > 0 || result.removed > 0) router.refresh();
    });
  }, [staleRoutes, cityId, router]);

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

  /**
   * Can a building stand on this tile?
   *
   * A function rather than a memo over `ghost`, because a click has to judge
   * the tile it just computed -- React state set in the same event has not
   * been applied yet, and validating the previous ghost silently refused
   * perfectly good lots.
   *
   * Uses the same pure module the server validates with, so the ghost never
   * promises a placement the action would refuse.
   */
  const verdictFor = useCallback(
    (tile: { x: number; y: number }) => {
      const hood = neighborhoods.find((n) => isInRegion(tile.x, tile.y, n));
      if (!hood) return { ok: false as const, reason: "outside-region" as const, hood: null };

      const terrainAt = (x: number, y: number): Terrain =>
        (tileByKey.get(`${x},${y}`)?.terrain as Terrain | undefined) ?? "grass";

      const verdict = canPlace({
        footprint: { tile_x: tile.x, tile_y: tile.y, footprint_w: 1, footprint_h: 1 },
        region: hood,
        occupied: buildings.map((b) => ({
          tile_x: b.tile_x,
          tile_y: b.tile_y,
          footprint_w: b.footprint_w,
          footprint_h: b.footprint_h,
        })),
        terrainAt,
        city: { width: cityWidth, height: cityHeight },
      });

      return verdict.ok ? { ok: true as const, hood } : { ...verdict, hood };
    },
    [neighborhoods, tileByKey, buildings, cityWidth, cityHeight],
  );

  const ghostVerdict = useMemo(
    () => (ghost && draft?.kind === "building" ? verdictFor(ghost) : null),
    [ghost, draft, verdictFor],
  );

  /** A district may not run off the map or overlap another district. */
  const districtVerdict = useMemo(() => {
    if (!ghost || draft?.kind !== "district") return false;
    if (ghost.x < 0 || ghost.y < 0) return false;
    if (ghost.x + draft.width > cityWidth || ghost.y + draft.height > cityHeight) return false;
    return !neighborhoods.some(
      (n) =>
        ghost.x < n.origin_x + n.width &&
        n.origin_x < ghost.x + draft.width &&
        ghost.y < n.origin_y + n.height &&
        n.origin_y < ghost.y + draft.height,
    );
  }, [ghost, draft, neighborhoods, cityWidth, cityHeight]);

  const handlePaved = useCallback(() => setPavingIds([]), []);

  /**
   * What the Build bar opens on.
   *
   * A building needs a district to stand in, so on a cleared map -- or a brand
   * new one -- opening on the building picker would refuse every lot the user
   * aimed at. Start them on the survey instead.
   */
  const openingDraft = useCallback(
    (): BuildDraft =>
      neighborhoods.length === 0
        ? { kind: "district", name: "", biome: "downtown", width: 8, height: 6 }
        : { kind: "building", artifactType: "doc", title: "" },
    [neighborhoods.length],
  );

  const labelForRoute = useCallback(
    (route: MapRoute) => {
      const count = `${route.linkCount} connection${route.linkCount === 1 ? "" : "s"}`;
      if (route.scope === "highway") {
        const a = hoodById.get(route.aNeighborhoodId ?? "")?.name ?? "Somewhere";
        const b = hoodById.get(route.bNeighborhoodId ?? "")?.name ?? "Somewhere";
        return `${a} ↔ ${b} — ${count}`;
      }
      const a = buildings.find((x) => x.id === route.aBuildingId)?.title ?? "—";
      const b = buildings.find((x) => x.id === route.bBuildingId)?.title ?? "—";
      return `${a} ↔ ${b} — ${count}`;
    },
    [hoodById, buildings],
  );

  /** Hovering a road lights up the buildings at both ends. */
  const highlightedBuildings = useMemo(() => {
    const route = routes.find((r) => r.id === hoveredRoad);
    return route ? new Set([route.aBuildingId, route.bBuildingId]) : new Set<string>();
  }, [routes, hoveredRoad]);

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
    if (draft) {
      if ((event.target as HTMLElement).closest("[data-map-chrome]")) return;
      // In build mode a press places rather than pans.
      const tile = tileAtPointer(event.clientX, event.clientY);
      if (tile) {
        setGhost(tile);
        void (draft.kind === "building" ? placeBuilding(tile) : placeDistrict(tile));
      }
      return;
    }

    // Only the background pans. Anything interactive is excluded, because
    // setPointerCapture on this container retargets the pointerup and the
    // child's click event never fires.
    if ((event.target as HTMLElement).closest("[data-building], [data-map-chrome]")) return;
    dragState.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      camX: camera.x,
      camY: camera.y,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  /** Screen point -> tile, undoing the camera transform. */
  const tileAtPointer = useCallback(
    (clientX: number, clientY: number) => {
      const rect = viewportRef.current?.getBoundingClientRect();
      if (!rect) return null;
      const worldX = (clientX - rect.left - camera.x) / camera.zoom;
      const worldY = (clientY - rect.top - camera.y) / camera.zoom;
      return screenToTile(worldX, worldY);
    },
    [camera],
  );

  function onPointerMove(event: React.PointerEvent<HTMLDivElement>) {
    if (draft) {
      // The ghost snaps between tiles rather than sliding with the cursor.
      const tile = tileAtPointer(event.clientX, event.clientY);
      if (tile && (tile.x !== ghost?.x || tile.y !== ghost?.y)) setGhost(tile);
    }

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
    const drag = dragState.current;
    if (drag?.pointerId !== event.pointerId) return;
    dragState.current = null;

    // Demolish mode still needs to pan, so a press on the ground is only a
    // pick if the pointer barely moved. Buildings and chrome never start a
    // drag, so reaching here means the press began on open map.
    if (!demolishing) return;
    const moved = Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY);
    if (moved > 4) return;
    const tile = tileAtPointer(event.clientX, event.clientY);
    if (tile) condemnAt(tile);
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
    if (draft) setGhost(next);

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
      event.preventDefault();
      if (draft) {
        void (draft.kind === "building" ? placeBuilding(cursor) : placeDistrict(cursor));
        return;
      }
      if (demolishing) {
        condemnAt(cursor);
        return;
      }
      const building = buildingAt(cursor.x, cursor.y);
      if (building) enterBuilding(building.id);
      return;
    }

    if (event.key === "Escape" && draft) {
      event.preventDefault();
      setDraft(null);
      setGhost(null);
      return;
    }

    if (event.key === "Escape" && demolishing) {
      event.preventDefault();
      // One Escape drops the condemned building, a second leaves the mode.
      if (condemned) setCondemned(null);
      else stopDemolishing();
      return;
    }

    if (event.key === "+" || event.key === "=") {
      setCamera((c) => ({ ...c, zoom: stepZoom(c.zoom, 1) }));
    } else if (event.key === "-") {
      setCamera((c) => ({ ...c, zoom: stepZoom(c.zoom, -1) }));
    }
  }

  /**
   * Place a building: validate, create, then run the construction sequence
   * before opening the new artifact.
   */
  const placeBuilding = useCallback(
    async (tile: { x: number; y: number }) => {
      if (!draft || draft.kind !== "building") return;

      const verdict = verdictFor(tile);
      if (!verdict.ok) {
        setBuildHint(REJECTION_MESSAGE[verdict.reason]);
        return;
      }
      const hood = verdict.hood;

      const title = draft.title.trim() || `New ${BUILDING_NOUN[draft.artifactType]}`;
      setBuildHint("Building…");
      setRaising(tile);

      const result = await createBuilding({
        neighborhoodId: hood.id,
        title,
        artifactType: draft.artifactType,
        tileX: tile.x,
        tileY: tile.y,
      });

      if (!result.ok) {
        setRaising(null);
        setBuildHint(result.error);
        return;
      }

      // The scaffold has been on screen since the click; give it its frames
      // before the interior takes over.
      if (!reduceMotion) await new Promise((resolve) => window.setTimeout(resolve, 520));

      setDraft(null);
      setGhost(null);
      setRaising(null);
      router.push(`/b/${result.data.id}`);
    },
    [draft, verdictFor, reduceMotion, router],
  );

  /** Found a district: place its top corner at the given tile. */
  const placeDistrict = useCallback(
    async (tile: { x: number; y: number }) => {
      if (!draft || draft.kind !== "district") return;
      if (!draft.name.trim()) {
        setBuildHint("Give the district a name first.");
        return;
      }

      setBuildHint("Surveying…");
      const result = await createNeighborhood({
        cityId,
        name: draft.name.trim(),
        description: "",
        biome: draft.biome,
        originX: tile.x,
        originY: tile.y,
        width: draft.width,
        height: draft.height,
      });

      if (!result.ok) {
        setBuildHint(result.error);
        return;
      }

      setDraft(null);
      setGhost(null);
      setBuildHint(null);
      router.refresh();
    },
    [draft, cityId, router],
  );

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

  /** Leave demolish mode, forgetting whatever was condemned. */
  const stopDemolishing = useCallback(() => {
    setDemolishing(false);
    setCondemned(null);
    setDemolishHint(null);
  }, []);

  /** What the bar is offering to take down, resolved for display. */
  const condemnedTarget = useMemo((): DemolishTarget | null => {
    if (!condemned) return null;

    if (condemned.kind === "building") {
      const building = buildings.find((b) => b.id === condemned.id);
      return building
        ? {
            kind: "building",
            id: building.id,
            title: building.title,
            noun: BUILDING_NOUN[building.artifact_type],
          }
        : null;
    }

    const hood = hoodById.get(condemned.id);
    return hood
      ? {
          kind: "district",
          id: hood.id,
          name: hood.name,
          buildingCount: buildings.filter((b) => b.neighborhood_id === hood.id).length,
        }
      : null;
  }, [condemned, buildings, hoodById]);

  /**
   * Take the condemned thing down.
   *
   * Demolish mode stays on afterwards: clearing a city is a repeated act, and
   * dropping the user back out to the map between each one is a worse tool
   * than leaving the bulldozer running.
   */
  const razeCondemned = useCallback(async () => {
    const target = condemnedTarget;
    if (!target || razing) return;

    setRazing(true);
    setDemolishHint(target.kind === "building" ? "Demolishing…" : "Dissolving…");
    const result =
      target.kind === "building"
        ? await deleteBuilding({ buildingId: target.id })
        : await deleteNeighborhood({ neighborhoodId: target.id });
    setRazing(false);

    if (!result.ok) {
      setDemolishHint(result.error);
      return;
    }

    setCondemned(null);
    setDemolishHint(
      target.kind === "building" ? `${target.title} came down.` : `${target.name} is gone.`,
    );
    router.refresh();
  }, [condemnedTarget, razing, router]);

  /** The district the bar is offering to dissolve, for marking on the ground. */
  const condemnedRegion = useMemo(
    () => (condemned?.kind === "district" ? (hoodById.get(condemned.id) ?? null) : null),
    [condemned, hoodById],
  );

  /**
   * Condemn whatever is on a tile: the building standing on it, or failing
   * that the district that owns the ground. Empty ground clears the selection,
   * which is how a click on grass reads.
   */
  const condemnAt = useCallback(
    (tile: { x: number; y: number }) => {
      setDemolishHint(null);
      const building = buildings.find(
        (b) =>
          tile.x >= b.tile_x &&
          tile.x < b.tile_x + b.footprint_w &&
          tile.y >= b.tile_y &&
          tile.y < b.tile_y + b.footprint_h,
      );
      if (building) {
        setCondemned({ kind: "building", id: building.id });
        return;
      }
      const hood = neighborhoods.find((n) => isInRegion(tile.x, tile.y, n));
      setCondemned(hood ? { kind: "district", id: hood.id } : null);
    },
    [buildings, neighborhoods],
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
      className={`relative h-full w-full touch-none overflow-hidden select-none ${
        draft || demolishing ? "cursor-crosshair" : "cursor-grab active:cursor-grabbing"
      }`}
    >
      <AmbientLayer light={light} />

      {/* The world. One transform for the whole map, snapped to whole pixels. */}
      <div
        data-world
        data-phase={light.phase}
        data-lamps={light.lampsOn ? "on" : "off"}
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

        {/* Roads: above terrain, below the buildings they arrive at */}
        <RoadLayer
          routes={routes}
          zoom={camera.zoom}
          hoveredId={hoveredRoad}
          onHover={setHoveredRoad}
          onSelect={setSelectedRoad}
          labelFor={labelForRoute}
          pavingIds={pavingIds}
          onPaved={handlePaved}
        />

        {/* Ground marked for clearance. Drawn at the same depth as the tiles
            it covers, so anything still standing on it reads above the mark. */}
        {condemnedRegion ? <CondemnedRegion region={condemnedRegion} range={range} /> : null}

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
          const isCondemned = condemned?.kind === "building" && condemned.id === b.id;

          return (
            <button
              key={b.id}
              data-building={b.id}
              data-biome={hood?.biome}
              data-status={hood?.status}
              type="button"
              onClick={() => {
                if (demolishing) {
                  setDemolishHint(null);
                  setCondemned({ kind: "building", id: b.id });
                  return;
                }
                enterBuilding(b.id);
              }}
              onFocus={() => setCursor({ x: b.tile_x, y: b.tile_y })}
              aria-label={
                demolishing
                  ? `Condemn ${BUILDING_NOUN[b.artifact_type]}: ${b.title}`
                  : `${BUILDING_NOUN[b.artifact_type]}: ${b.title}${hood ? `, in ${hood.name}` : ""}`
              }
              className="group absolute block border-0 bg-transparent p-0"
              style={{
                left: snap(screen.x - geometry.originX),
                top: snap(screen.y - geometry.originY),
                width: geometry.width,
                height: geometry.height,
                zIndex: depthFor(b.tile_x, b.tile_y, b.footprint_w, b.footprint_h) + 1,
                transform: isEntering
                  ? "translateY(2px) scaleY(0.92)"
                  : highlightedBuildings.has(b.id) || isCondemned
                    ? "translateY(-2px)"
                    : undefined,
                filter: highlightedBuildings.has(b.id) ? "drop-shadow(0 0 0 var(--color-gold))" : undefined,
                outline: isCondemned
                  ? "3px solid var(--color-brick)"
                  : highlightedBuildings.has(b.id)
                    ? "2px solid var(--color-gold)"
                    : undefined,
                outlineOffset: isCondemned ? 2 : undefined,
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

        {/* Ghost sprite and the lot it would occupy */}
        {draft?.kind === "building" && ghost ? (
          <GhostLot
            tile={ghost}
            valid={ghostVerdict?.ok ?? false}
            artifactType={draft.artifactType}
            biome={ghostVerdict?.hood?.biome}
          />
        ) : null}

        {draft?.kind === "district" && ghost ? (
          <GhostRegion
            origin={ghost}
            width={draft.width}
            height={draft.height}
            biome={draft.biome}
            valid={districtVerdict}
          />
        ) : null}

        {/* Construction site, from the click until the interior opens */}
        {raising ? <Scaffold tile={raising} reduceMotion={reduceMotion} /> : null}
      </div>

      {/* Either mode dims the world so the ghost, or the condemned building,
          reads clearly against it. */}
      {draft || demolishing ? (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{ backgroundColor: "var(--color-ink)", opacity: 0.22 }}
        />
      ) : null}

      {draft ? (
        <div data-map-chrome className="pointer-events-none absolute bottom-3 left-3 z-10 max-w-[min(46rem,calc(100%-1.5rem))]">
          <BuildBar
            draft={draft}
            onChange={setDraft}
            onCancel={() => {
              setDraft(null);
              setGhost(null);
              setBuildHint(null);
            }}
            hint={
              buildHint ??
              (ghostVerdict && !ghostVerdict.ok ? REJECTION_MESSAGE[ghostVerdict.reason] : null)
            }
          />
        </div>
      ) : null}

      {demolishing ? (
        <div data-map-chrome className="pointer-events-none absolute bottom-3 left-3 z-10 max-w-[min(46rem,calc(100%-1.5rem))]">
          <DemolishBar
            target={condemnedTarget}
            pending={razing}
            hint={demolishHint}
            onConfirm={() => void razeCondemned()}
            onClear={() => {
              setCondemned(null);
              setDemolishHint(null);
            }}
            onExit={stopDemolishing}
          />
        </div>
      ) : null}

      {!draft && !demolishing ? (
        <div data-map-chrome className="absolute left-3 top-3 z-10 flex gap-2">
          <button
            type="button"
            onClick={() => {
              setDraft(openingDraft());
              setBuildHint(null);
            }}
            className="border-2 border-ink bg-amber px-3 py-1 font-pixel text-[10px] uppercase shadow-hard"
          >
            Build
          </button>
          <button
            type="button"
            onClick={() => {
              setDemolishing(true);
              setCondemned(null);
              setDemolishHint(null);
            }}
            className="border-2 border-ink bg-paper px-3 py-1 font-pixel text-[10px] uppercase text-brick shadow-hard"
          >
            Demolish
          </button>
        </div>
      ) : null}

      {selectedRoad ? (() => {
        const route = routes.find((r) => r.id === selectedRoad);
        if (!route) return null;
        return (
          <ConnectionsPanel
            route={route}
            label={labelForRoute(route)}
            links={routeLinks[route.id] ?? []}
            onClose={() => setSelectedRoad(null)}
          />
        );
      })() : null}

      {/* Zoom readout / controls */}
      <div className="pointer-events-none absolute bottom-3 right-3 border-2 border-ink bg-paper px-2 py-1 font-pixel text-[10px] uppercase text-ink shadow-hard">
        {camera.zoom}×
      </div>

      <div data-map-chrome className="absolute bottom-0 left-0 right-0 z-20">
        <Ticker headlines={headlines} />
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

/** The ghost: a translucent sprite on the lot under the cursor, with the
 *  lot itself pulsing green when it can be built on and red when it cannot. */
function GhostLot({
  tile,
  valid,
  artifactType,
  biome,
}: {
  tile: { x: number; y: number };
  valid: boolean;
  artifactType: MapBuilding["artifact_type"];
  biome: string | undefined;
}) {
  const screen = tileToScreen(tile.x, tile.y);
  const geometry = buildingSprite(SPRITE_FOR_TYPE[artifactType], 1, 1, 1, 1);

  return (
    <>
      <div
        aria-hidden
        className="pointer-events-none absolute"
        style={{
          left: snap(screen.x - TILE_W / 2),
          top: snap(screen.y),
          width: TILE_W,
          height: TILE_H,
          zIndex: tile.x + tile.y + 900,
        }}
      >
        <svg width={TILE_W} height={TILE_H} className="pixelated block" shapeRendering="crispEdges">
          <polygon
            points={TILE_DIAMOND}
            fill={valid ? "var(--color-lime)" : "var(--color-brick)"}
            fillOpacity={0.75}
            stroke="var(--color-ink)"
            strokeWidth={2}
          />
        </svg>
      </div>

      <div
        aria-hidden
        data-biome={biome}
        className="pointer-events-none absolute"
        style={{
          left: snap(screen.x - geometry.originX),
          top: snap(screen.y - geometry.originY),
          width: geometry.width,
          height: geometry.height,
          zIndex: tile.x + tile.y + 901,
          opacity: valid ? 0.75 : 0.35,
        }}
      >
        <Sprite geometry={geometry} />
      </div>
    </>
  );
}

/** Four stepped frames of scaffold, then a dust puff. */
function Scaffold({ tile, reduceMotion }: { tile: { x: number; y: number }; reduceMotion: boolean }) {
  const screen = tileToScreen(tile.x, tile.y);
  const scaffoldRef = useRef<HTMLDivElement>(null);
  const dustRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (reduceMotion) return;
    if (scaffoldRef.current && dustRef.current) {
      void raiseBuilding(scaffoldRef.current, dustRef.current);
    }
  }, [reduceMotion]);

  const geometry = buildingSprite("hoarding", 1, 1, 1, 1);

  return (
    <>
      <div
        ref={scaffoldRef}
        aria-hidden
        className="pointer-events-none absolute origin-bottom"
        style={{
          left: snap(screen.x - geometry.originX),
          top: snap(screen.y - geometry.originY),
          width: geometry.width,
          height: geometry.height,
          zIndex: tile.x + tile.y + 902,
        }}
      >
        <Sprite geometry={geometry} />
      </div>
      <div
        ref={dustRef}
        aria-hidden
        className="pointer-events-none absolute"
        style={{
          left: snap(screen.x - TILE_W / 2),
          top: snap(screen.y - 6),
          width: TILE_W,
          height: TILE_H,
          zIndex: tile.x + tile.y + 903,
          opacity: 0,
        }}
      >
        <svg width={TILE_W} height={TILE_H} className="pixelated block" shapeRendering="crispEdges">
          <polygon points={TILE_DIAMOND} fill="var(--color-mist)" />
        </svg>
      </div>
    </>
  );
}

/** A condemned district, marked out tile by tile in demolition red. */
function CondemnedRegion({
  region,
  range,
}: {
  region: MapNeighborhood;
  range: { minX: number; maxX: number; minY: number; maxY: number };
}) {
  const tiles: Array<{ x: number; y: number }> = [];
  for (let y = Math.max(region.origin_y, range.minY); y < Math.min(region.origin_y + region.height, range.maxY + 1); y++) {
    for (let x = Math.max(region.origin_x, range.minX); x < Math.min(region.origin_x + region.width, range.maxX + 1); x++) {
      tiles.push({ x, y });
    }
  }

  return (
    <div aria-hidden>
      {tiles.map((tile) => {
        const screen = tileToScreen(tile.x, tile.y);
        return (
          <div
            key={`c-${tile.x}-${tile.y}`}
            className="pointer-events-none absolute"
            style={{
              left: snap(screen.x - TILE_W / 2),
              top: snap(screen.y),
              width: TILE_W,
              height: TILE_H,
              zIndex: tile.x + tile.y,
            }}
          >
            <svg width={TILE_W} height={TILE_H} className="pixelated block" shapeRendering="crispEdges">
              <polygon
                points={TILE_DIAMOND}
                fill="var(--color-brick)"
                fillOpacity={0.45}
                stroke="var(--color-brick)"
                strokeWidth={1}
              />
            </svg>
          </div>
        );
      })}
    </div>
  );
}

/** The district ghost: every tile the new region would claim. */
function GhostRegion({
  origin,
  width,
  height,
  biome,
  valid,
}: {
  origin: { x: number; y: number };
  width: number;
  height: number;
  biome: string;
  valid: boolean;
}) {
  const tiles: Array<{ x: number; y: number }> = [];
  for (let dy = 0; dy < height; dy++) {
    for (let dx = 0; dx < width; dx++) tiles.push({ x: origin.x + dx, y: origin.y + dy });
  }

  return (
    <div aria-hidden data-biome={biome}>
      {tiles.map((tile) => {
        const screen = tileToScreen(tile.x, tile.y);
        return (
          <div
            key={`g-${tile.x}-${tile.y}`}
            className="pointer-events-none absolute"
            style={{
              left: snap(screen.x - TILE_W / 2),
              top: snap(screen.y),
              width: TILE_W,
              height: TILE_H,
              zIndex: tile.x + tile.y + 900,
            }}
          >
            <svg width={TILE_W} height={TILE_H} className="pixelated block" shapeRendering="crispEdges">
              <polygon
                points={TILE_DIAMOND}
                fill={valid ? "var(--biome-ground)" : "var(--color-brick)"}
                fillOpacity={0.7}
                stroke="var(--color-ink)"
                strokeWidth={1}
              />
            </svg>
          </div>
        );
      })}
    </div>
  );
}
