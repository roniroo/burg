import type { PGlite } from "@electric-sql/pglite";
import { PostgrestClient } from "@supabase/postgrest-js";
import type { Database } from "@/lib/database.types";
import { restHandler } from "@/lib/db/rest";

/** The query builder every server module uses: postgrest-js, typed by the schema. */
export type Client = PostgrestClient<Database>;

/**
 * A postgrest-js client whose requests never leave the process: its `fetch`
 * is the local PostgREST in lib/db/rest.ts. The origin is a placeholder that
 * nothing resolves; only the path and query string are read.
 */
export function clientFor(db: Pick<PGlite, "query" | "transaction">): Client {
  const handle = restHandler(db);
  return new PostgrestClient<Database>("http://burg.local/rest/v1", {
    fetch: (input, init) => handle(new Request(input, init)),
  });
}
