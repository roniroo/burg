"use client";

import { Fragment, useEffect } from "react";
import { animate, stagger } from "animejs";
import { DURATION, STEP_SPRITE, prefersReducedMotion } from "@/lib/anim";
import { TILE_H, TILE_W, snap, tileToScreen } from "@/lib/iso";
import type { PathTile, RoadTier } from "@/lib/roads";

export type MapRoute = {
  id: string;
  tier: RoadTier;
  scope: "street" | "highway";
  linkCount: number;
  path: PathTile[];
  aBuildingId: string;
  bBuildingId: string;
  aNeighborhoodId: string | null;
  bNeighborhoodId: string | null;
};

/**
 * How wide a road sits in its tile, and what it is made of.
 *
 * Width carries the link count, so the busiest dependency in the city is also
 * the biggest piece of infrastructure on the map -- readable before you have
 * read a single label.
 */
const TIER_STYLE: Record<RoadTier, { halfWidth: number; fill: string; edge: string }> = {
  dirt: { halfWidth: 3, fill: "var(--color-dust)", edge: "var(--color-stone)" },
  cobble: { halfWidth: 5, fill: "var(--color-ash)", edge: "var(--color-slate)" },
  paved: { halfWidth: 7, fill: "var(--color-stone)", edge: "var(--color-ink)" },
  highway: { halfWidth: 9, fill: "var(--color-slate)", edge: "var(--color-ink)" },
};

const CENTRE = { x: TILE_W / 2, y: TILE_H / 2 };

/**
 * Where a step in tile space meets the edge of the tile, in screen space.
 *
 * Moving +x on the grid travels toward the south-east edge of the diamond,
 * +y toward the south-west, and so on. A road drawn from the tile centre out
 * to these points meets its neighbour's band exactly, which is what makes a
 * run of tiles read as one continuous road rather than a dotted line.
 */
function edgeMidpoint(dx: number, dy: number): { x: number; y: number } {
  return {
    x: CENTRE.x + (dx - dy) * (TILE_W / 4),
    y: CENTRE.y + (dx + dy) * (TILE_H / 4),
  };
}

/** A band from the tile centre to one edge, `halfWidth` px to each side. */
function bandPoints(dx: number, dy: number, halfWidth: number): string {
  const end = edgeMidpoint(dx, dy);
  const vx = end.x - CENTRE.x;
  const vy = end.y - CENTRE.y;
  const length = Math.hypot(vx, vy) || 1;
  // Perpendicular, scaled to the road's width.
  const px = (-vy / length) * halfWidth;
  const py = (vx / length) * halfWidth;

  return [
    `${CENTRE.x + px},${CENTRE.y + py}`,
    `${end.x + px},${end.y + py}`,
    `${end.x - px},${end.y - py}`,
    `${CENTRE.x - px},${CENTRE.y - py}`,
  ].join(" ");
}

/** A small square at the junction, so corners and endpoints are not notched. */
function hubPoints(halfWidth: number): string {
  const w = halfWidth;
  const h = halfWidth / 2;
  return `${CENTRE.x},${CENTRE.y - h} ${CENTRE.x + w},${CENTRE.y} ${CENTRE.x},${CENTRE.y + h} ${CENTRE.x - w},${CENTRE.y}`;
}

/**
 * The road layer.
 *
 * Drawn between terrain and buildings, so a road passes behind whatever it
 * arrives at. Level of detail follows zoom: at city zoom only highways,
 * bridges and gates are shown, because at that altitude you are reading
 * district-to-district dependencies and nothing finer.
 */
export function RoadLayer({
  routes,
  zoom,
  hoveredId,
  onHover,
  onSelect,
  labelFor,
  pavingIds,
  onPaved,
}: {
  routes: MapRoute[];
  zoom: number;
  hoveredId: string | null;
  onHover: (id: string | null) => void;
  onSelect: (id: string) => void;
  labelFor: (route: MapRoute) => string;
  /** Routes solved just now, which lay themselves down tile by tile. */
  pavingIds?: string[];
  onPaved?: () => void;
}) {
  /**
   * The paving ceremony.
   *
   * A new link does not just appear as a road: the route lays itself from one
   * end to the other in stepped frames. Kept under 700ms, and skipped entirely
   * under reduced motion -- where the road is simply there.
   */
  useEffect(() => {
    if (!pavingIds || pavingIds.length === 0) return;
    if (prefersReducedMotion()) {
      onPaved?.();
      return;
    }

    const tiles = pavingIds.flatMap((id) =>
      Array.from(document.querySelectorAll<HTMLElement>(`[data-road-tile="${id}"]`)),
    );
    if (tiles.length === 0) {
      onPaved?.();
      return;
    }

    const perTile = Math.min(40, Math.max(8, Math.floor(DURATION.ceremony / tiles.length)));
    animate(tiles, {
      opacity: [0, 1],
      scale: [0.4, 1],
      duration: 160,
      ease: STEP_SPRITE,
      delay: stagger(perTile),
      onComplete: () => onPaved?.(),
    });
  }, [pavingIds, onPaved]);

  const cityZoom = zoom === 1;
  const visible = routes.filter((r) => (cityZoom ? r.scope === "highway" : true));

  return (
    <>
      {visible.map((route) => {
        const style = TIER_STYLE[route.tier];
        const hovered = hoveredId === route.id;

        // At city zoom a highway fades to its gate stubs plus the crossing,
        // so districts read as connected without drawing the whole run.
        const tiles = route.path;
        const midpoint = tiles[Math.floor(tiles.length / 2)];

        return (
          <Fragment key={route.id}>
            {tiles.map((tile, i) => {
              const screen = tileToScreen(tile.x, tile.y);
              const isBridge = tile.segment === "bridge";
              const isGate = tile.segment === "gate";

              // Directions this tile connects to, from its neighbours in the path.
              const steps: Array<{ dx: number; dy: number }> = [];
              for (const other of [tiles[i - 1], tiles[i + 1]]) {
                if (!other) continue;
                const dx = other.x - tile.x;
                const dy = other.y - tile.y;
                if (Math.abs(dx) + Math.abs(dy) === 1) steps.push({ dx, dy });
              }

              const fill = hovered
                ? "var(--color-gold)"
                : isBridge
                  ? "var(--color-sand)"
                  : isGate
                    ? "var(--color-clay)"
                    : style.fill;

              return (
                <div
                  key={`${route.id}-${i}`}
                  aria-hidden
                  data-road-tile={route.id}
                  className="pointer-events-none absolute"
                  style={{
                    left: snap(screen.x - TILE_W / 2),
                    top: snap(screen.y),
                    width: TILE_W,
                    height: TILE_H,
                    // Roads sit above terrain and below the buildings on the
                    // same tile: same depth key, one less than a building's.
                    zIndex: tile.x + tile.y,
                  }}
                >
                  <svg width={TILE_W} height={TILE_H} className="pixelated block" shapeRendering="crispEdges">
                    {steps.map((step, si) => (
                      <polygon
                        key={si}
                        points={bandPoints(step.dx, step.dy, style.halfWidth)}
                        fill={fill}
                        stroke={style.edge}
                        strokeWidth={isBridge ? 1 : 0.5}
                      />
                    ))}
                    <polygon points={hubPoints(style.halfWidth)} fill={fill} stroke="none" />
                    {isGate ? (
                      <polygon
                        points={hubPoints(style.halfWidth + 3)}
                        fill="none"
                        stroke="var(--color-brick)"
                        strokeWidth={2}
                      />
                    ) : null}
                    {/* Highways carry lamps; the tier is legible at a glance. */}
                    {route.tier === "highway" && i % 4 === 0 ? (
                      <rect
                        x={CENTRE.x - 1}
                        y={CENTRE.y - 9}
                        width={2}
                        height={7}
                        fill="var(--color-gold)"
                        stroke="var(--color-ink)"
                        strokeWidth={0.5}
                      />
                    ) : null}
                  </svg>
                </div>
              );
            })}

            {/* One focusable handle per road, at its midpoint. */}
            {midpoint ? (
              <button
                type="button"
                data-map-chrome
                data-road={route.id}
                onMouseEnter={() => onHover(route.id)}
                onMouseLeave={() => onHover(null)}
                onFocus={() => onHover(route.id)}
                onBlur={() => onHover(null)}
                onClick={() => onSelect(route.id)}
                aria-label={labelFor(route)}
                className="absolute"
                style={{
                  left: snap(tileToScreen(midpoint.x, midpoint.y).x - 8),
                  top: snap(tileToScreen(midpoint.x, midpoint.y).y + TILE_H / 2 - 8),
                  width: 16,
                  height: 16,
                  zIndex: midpoint.x + midpoint.y + 500,
                  background: "transparent",
                  border: 0,
                  padding: 0,
                }}
              />
            ) : null}

            {hovered && midpoint ? (
              <div
                aria-hidden
                className="pointer-events-none absolute whitespace-nowrap border-2 border-ink bg-paper px-1 font-pixel text-[10px] uppercase text-ink shadow-hard"
                style={{
                  left: snap(tileToScreen(midpoint.x, midpoint.y).x - 40),
                  top: snap(tileToScreen(midpoint.x, midpoint.y).y - 18),
                  zIndex: 10_000,
                }}
              >
                {labelFor(route)}
              </div>
            ) : null}
          </Fragment>
        );
      })}
    </>
  );
}
