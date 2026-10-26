/**
 * Shared by the check suites and dev scripts: the dev database, by way of the
 * running dev server.
 *
 * Not a runnable script -- a module the others import.
 *
 * PGlite lets one process hold the data directory, and while `npm run dev` is
 * up that process is the server, so scripts reach the database through it:
 * app/api/dev/rest is the local PostgREST over HTTP, and this is the same
 * postgrest-js client the app uses, pointed there. It only exists under
 * `next dev`, so nothing here can reach the desktop app's database.
 */
import { PostgrestClient } from "@supabase/postgrest-js";
import type { Database } from "../lib/database.types";

export const BASE_URL = process.env.BURG_URL ?? "http://localhost:3000";

export type Admin = PostgrestClient<Database>;

export const admin: Admin = new PostgrestClient<Database>(`${BASE_URL}/api/dev/rest`, {
  headers: { apikey: "dev" },
});
