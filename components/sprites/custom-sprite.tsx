import { customSpriteUrl, spriteLayout, type CustomSpriteMeta } from "@/lib/custom-sprites";

type Drawable = Pick<CustomSpriteMeta, "width" | "height" | "footprint_w" | "footprint_h" | "hit_area">;

/**
 * Draws a sprite from the library at its on-map size.
 *
 * SVG rather than <img> for the same reason the built-in sprites are: a
 * building's hit area is its art (see globals.css). The image itself takes no
 * clicks; an invisible polygon around its opaque pixels does, and the rule
 * that lets a built-in sprite's polygons be clicked lets this one be too.
 *
 * The viewBox is in the image's own pixels, so the hit area needs no scaling.
 */
export function CustomSprite({
  sprite,
  src,
  opacity,
}: {
  sprite: Drawable & { id?: string };
  /** Defaults to the library URL; the uploader passes a local preview. */
  src?: string;
  opacity?: number;
}) {
  const layout = spriteLayout(sprite);
  return (
    <svg
      viewBox={`0 0 ${sprite.width} ${sprite.height}`}
      width={layout.width}
      height={layout.height}
      preserveAspectRatio="none"
      className="block"
      aria-hidden
      focusable="false"
    >
      <image
        href={src ?? (sprite.id ? customSpriteUrl(sprite.id) : undefined)}
        width={sprite.width}
        height={sprite.height}
        opacity={opacity}
        preserveAspectRatio="none"
        style={{ imageRendering: layout.crisp ? "pixelated" : "auto" }}
      />
      <polygon points={sprite.hit_area} fill="transparent" />
    </svg>
  );
}
