import type { SpriteGeometry } from "@/lib/sprites";

/**
 * Renders a sprite's geometry as inline SVG.
 *
 * Inline rather than an <img> to /public/sprites because every face is tinted
 * from the biome's CSS custom properties, and an <img>-loaded SVG cannot see
 * the page's variables. The registry in lib/sprites.ts remains the only place
 * that knows what a building looks like.
 */
export function Sprite({ geometry, className }: { geometry: SpriteGeometry; className?: string }) {
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
          stroke={shape.stroke ? "var(--color-ink)" : "none"}
          strokeWidth={shape.stroke ? 1 : 0}
          strokeLinejoin="miter"
        />
      ))}
    </svg>
  );
}
