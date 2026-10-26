import { getCustomSprites } from "@/lib/queries";
import { SpriteUploader } from "@/components/sprites/sprite-uploader";
import { LotPreview } from "@/components/sprites/lot-preview";
import { DeleteSprite } from "@/components/sprites/delete-sprite";

export const metadata = { title: "Sprites — Burg" };

/**
 * The sprite library: art you drew, for any building in any city here.
 *
 * Uploading only adds to the library. A building puts a sprite on from its own
 * page, or is built in one from the Build bar, because either can change the
 * building's lot and that is the map's business.
 */
export default async function SpritesPage() {
  const sprites = await getCustomSprites();

  return (
    <div className="mx-auto max-w-4xl p-6">
      <h1 className="font-display text-3xl">Sprites</h1>
      <p className="mt-1 max-w-2xl font-body text-sm text-stone">
        Your own art for buildings. Add a PNG here, then give a building that look from its page, or pick it in the
        Build bar when you raise one.
      </p>

      <section aria-labelledby="add-sprite" className="mt-8">
        <h2 id="add-sprite" className="font-display text-xl">
          Add a sprite
        </h2>
        <ul className="mt-2 mb-3 list-disc pl-3 font-body text-sm text-stone">
          <li>
            Draw it as wide as its lot: 64 pixels for a single tile, 128 for a 2×2, and in general 32 for every
            tile of width and every tile of depth. Exactly 2× or 3× that is fine too.
          </li>
          <li>The bottom of the image is the lot&apos;s bottom corner. Anything taller just rises above it.</li>
          <li>Leave the background transparent. Only the parts you painted can be clicked on the map.</li>
        </ul>
        <SpriteUploader />
      </section>

      <section aria-labelledby="library" className="mt-10">
        <h2 id="library" className="font-display text-xl">
          Library
        </h2>
        {sprites.length === 0 ? (
          <p className="mt-2 font-body text-sm text-stone">Nothing here yet.</p>
        ) : (
          <ul className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {sprites.map((sprite) => (
              <li key={sprite.id} data-sprite={sprite.id} className="flex flex-col gap-2 border-2 border-ink bg-snow p-2 shadow-hard">
                <div className="flex min-h-20 items-end justify-center">
                  <LotPreview sprite={sprite} fit={160} />
                </div>
                <div>
                  <h3 className="font-display text-lg leading-tight">{sprite.name}</h3>
                  <p className="font-pixel text-[10px] uppercase text-stone">
                    {sprite.footprint_w}×{sprite.footprint_h} lot ·{" "}
                    {sprite.uses === 0 ? "not in use" : `${sprite.uses} building${sprite.uses === 1 ? "" : "s"}`}
                  </p>
                </div>
                <DeleteSprite spriteId={sprite.id} name={sprite.name} uses={sprite.uses} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
