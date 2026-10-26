import { z } from "zod";
import { database } from "@/lib/db/server";
import { spriteImage } from "@/lib/db/sprites";

/**
 * A custom sprite's image, by id.
 *
 * Deliberately not under a path ending in `.png`: the launch-token check in
 * proxy.ts covers every route, and this is somebody's own art. A sprite's
 * image never changes under its id -- replacing one is uploading another -- so
 * the window may keep it for as long as it likes.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) return new Response(null, { status: 404 });

  const image = await spriteImage(await database(), id);
  if (!image) return new Response(null, { status: 404 });

  return new Response(image, {
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": "private, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
