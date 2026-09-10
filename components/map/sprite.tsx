import type { SpriteGeometry } from "@/lib/sprites";

/**
 * Renders a sprite's geometry as inline SVG.
 *
 * Inline rather than an <img> to /public/sprites because every face is tinted
 * from the biome's CSS custom properties, and an <img>-loaded SVG cannot see
 * the page's variables. The registry in lib/sprites.ts remains the only place
 * that knows what a building looks like.
 *
 * Two additions over the previous version, both driven by the registry: a
 * shape may carry `opacity` and `dash` (the ghost and boarded states), and a
 * sprite may carry a `smoke` group -- chimney puffs and water shimmer, kept
 * separate so one CSS animation drives them and one media query stops them.
 */
export function Sprite({
  geometry,
  className,
  animate = true,
}: {
  geometry: SpriteGeometry;
  className?: string;
  /** Set false for thumbnails, print, and anything offscreen. */
  animate?: boolean;
}) {
  return (
    <svg
      viewBox={geometry.viewBox}
      width={geometry.width}
      height={geometry.height}
      className={`pixelated block ${className ?? ""}`}
      shapeRendering="crispEdges"
      aria-hidden
      focusable="false"
    >
      {geometry.shapes.map((shape, i) => (
        <polygon
          key={i}
          points={shape.points}
          fill={shape.fill}
          fillOpacity={shape.opacity ?? 1}
          stroke={shape.stroke === false ? "none" : "var(--color-ink)"}
          strokeWidth={shape.stroke === false ? 0 : 1}
          strokeDasharray={shape.dash}
          strokeLinejoin="miter"
        />
      ))}
      {geometry.smoke.length > 0 ? (
        <g className={animate ? "sprite-puff" : undefined}>
          {geometry.smoke.map((shape, i) => (
            <polygon key={i} points={shape.points} fill={shape.fill} fillOpacity={shape.opacity ?? 1} />
          ))}
        </g>
      ) : null}
    </svg>
  );
}
