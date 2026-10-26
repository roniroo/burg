import type { PGlite } from "@electric-sql/pglite";

/**
 * Custom sprite images in and out of the database.
 *
 * Everything else about a sprite goes through the postgrest-js client like the
 * rest of the app, but the image does not: through PostgREST a bytea column
 * becomes a hex string inside JSON, twice the size, and then has to be decoded
 * again. These two read and write the bytes directly.
 */

type Queryable = Pick<PGlite, "query">;

export type NewSprite = {
  name: string;
  image: Uint8Array;
  width: number;
  height: number;
  footprintW: number;
  footprintH: number;
  hitArea: string;
};

export async function insertSprite(db: Queryable, sprite: NewSprite): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `insert into public.custom_sprites (name, image, width, height, footprint_w, footprint_h, hit_area)
     values ($1, $2, $3, $4, $5, $6, $7)
     returning id`,
    [sprite.name, sprite.image, sprite.width, sprite.height, sprite.footprintW, sprite.footprintH, sprite.hitArea],
  );
  return rows[0]!.id;
}

/** A copy on its own ArrayBuffer, which is what a Response body accepts. */
export async function spriteImage(db: Queryable, id: string): Promise<Uint8Array<ArrayBuffer> | null> {
  const { rows } = await db.query<{ image: Uint8Array }>("select image from public.custom_sprites where id = $1", [
    id,
  ]);
  const image = rows[0]?.image;
  return image ? new Uint8Array(image) : null;
}
