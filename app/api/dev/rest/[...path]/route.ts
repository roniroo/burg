import { database } from "@/lib/db/server";
import { restHandler } from "@/lib/db/rest";

/**
 * The local PostgREST over HTTP, for the check suites and dev scripts -- and
 * only under `next dev`.
 *
 * PGlite lets one process open a data directory, and while the dev server is
 * running that process is the dev server. A script that wants to read or
 * reset the dev database therefore has to ask the server, and this route is
 * how: point postgrest-js at /api/dev/rest and it behaves as it did against
 * Supabase. See scripts/local-db.ts.
 *
 * Production builds, which include the desktop app, answer 404. Every request
 * must carry an `apikey` header, as postgrest-js always sends one: a custom
 * header forces a browser to send a CORS preflight first, which nothing here
 * answers, so a web page cannot use this route even on a developer's machine.
 */
async function handle(request: Request): Promise<Response> {
  if (process.env.NODE_ENV !== "development") return new Response(null, { status: 404 });
  if (!request.headers.get("apikey")) return new Response(null, { status: 401 });
  return restHandler(await database())(request);
}

export { handle as DELETE, handle as GET, handle as HEAD, handle as PATCH, handle as POST };
