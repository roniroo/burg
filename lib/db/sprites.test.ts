import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { openDatabase } from "./open";
import { clientFor } from "./client";
import { insertSprite, spriteImage } from "./sprites";
import { seedIdeaburg } from "@/lib/seed/ideaburg";

describe("custom sprites in the database", () => {
  let db: PGlite;

  beforeAll(async () => {
    db = await openDatabase();
  }, 60_000);

  afterAll(() => db.close());

  const image = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 1, 2, 254, 255]);
  const sprite = { name: "Tower", image, width: 128, height: 160, footprintW: 2, footprintH: 2, hitArea: "0,0 128,0 64,160" };

  it("keeps the bytes exactly", async () => {
    const id = await insertSprite(db, sprite);
    expect(await spriteImage(db, id)).toEqual(image);
    expect(await spriteImage(db, "00000000-0000-4000-8000-000000000000")).toBeNull();
  });

  it("refuses a lot bigger than a building may have", async () => {
    await expect(insertSprite(db, { ...sprite, footprintW: 5 })).rejects.toMatchObject({ code: "23514" });
  });

  it("hands buildings back their usual look when deleted", async () => {
    const { rows } = await db.query<{ id: string }>("insert into auth.users (email) values ('you@burg.local') returning id");
    const client = clientFor(db);
    const { cityId } = await seedIdeaburg(client, rows[0]!.id);
    const id = await insertSprite(db, sprite);

    const { data: building } = await client.from("buildings").select("id").eq("city_id", cityId).limit(1).single();
    await client.from("buildings").update({ custom_sprite_id: id }).eq("id", building!.id);
    await client.from("custom_sprites").delete().eq("id", id);

    const { data: after } = await client.from("buildings").select("custom_sprite_id").eq("id", building!.id).single();
    expect(after).toEqual({ custom_sprite_id: null });
  });
});
