import { lotTiles, spriteLayout, type CustomSpriteMeta } from "@/lib/custom-sprites";
import { TILE_H } from "@/lib/iso";
import { TERRAIN_FILL } from "@/lib/sprites";
import { CustomSprite } from "./custom-sprite";

type Drawable = Pick<CustomSpriteMeta, "width" | "height" | "footprint_w" | "footprint_h" | "hit_area">;

/**
 * A sprite standing on its lot, the way the map will draw it: the ground
 * diamonds underneath, the image on the lot's bottom corner. Blown up by a
 * whole number so small pixel art is readable and still never resampled.
 */
export function LotPreview({
  sprite,
  src,
  fit = 192,
}: {
  sprite: Drawable & { id?: string };
  src?: string;
  /** Roughly how wide, in CSS pixels, the preview may be. */
  fit?: number;
}) {
  const layout = spriteLayout(sprite);
  const lotHeight = (sprite.footprint_w + sprite.footprint_h) * (TILE_H / 2);
  const height = Math.max(layout.height, lotHeight);
  const zoom = Math.min(3, Math.max(1, Math.floor(fit / layout.width)));

  return (
    <div className="relative" style={{ width: layout.width * zoom, height: height * zoom }}>
      <div
        className="absolute left-0 top-0 origin-top-left"
        style={{ width: layout.width, height, transform: `scale(${zoom})` }}
      >
        <svg width={layout.width} height={height} className="pixelated absolute inset-0" shapeRendering="crispEdges" aria-hidden>
          {lotTiles(sprite.footprint_w, sprite.footprint_h, height).map((tile, i) => (
            <polygon
              key={i}
              points={tile.map((p) => `${p.x},${p.y}`).join(" ")}
              fill={TERRAIN_FILL.grass}
              stroke="var(--color-ink)"
              strokeWidth={1}
              strokeOpacity={0.35}
            />
          ))}
        </svg>
        <div className="absolute bottom-0 left-0">
          <CustomSprite sprite={sprite} src={src} />
        </div>
      </div>
    </div>
  );
}
