import path from "node:path";
import { connection } from "next/server";
import type { PGlite } from "@electric-sql/pglite";
import { clientFor, type Client } from "@/lib/db/client";
import { openDatabase } from "@/lib/db/open";
import { seedIdeaburg } from "@/lib/seed/ideaburg";

/**
 * The one database this server process holds open.
 *
 * Opened lazily on the first query and kept on `globalThis`, so that a dev
 * server's hot reloads reuse it instead of trying to open the same data
 * directory twice -- which PGlite cannot do.
 *
 * Where it lives: `BURG_DATA_DIR` if set (the desktop app points it into
 * ~/Library/Application Support/Burg), otherwise `.burg-data/` in the repo,
 * which is the dev database and the one the check suites are allowed to wreck.
 */

const store = globalThis as typeof globalThis & { __burgDatabase?: Promise<PGlite> };

export function dataDir(): string {
  return process.env.BURG_DATA_DIR ?? path.join(/* turbopackIgnore: true */ process.cwd(), ".burg-data");
}

export function database(): Promise<PGlite> {
  // `next build` prerenders what it can. Opening the data directory from a
  // build would put a second process on files the dev server or the app may
  // already hold, which is how a PGlite database gets corrupted.
  if (process.env.NEXT_PHASE === "phase-production-build") {
    throw new Error("Burg's database was asked for during `next build`; the caller needs `await connection()`.");
  }
  store.__burgDatabase ??= boot().catch((error: unknown) => {
    // Do not cache a failure: the next request should try again, not inherit it.
    store.__burgDatabase = undefined;
    throw error;
  });
  return store.__burgDatabase;
}

/**
 * The query builder, bound to this machine's database.
 *
 * `connection()` marks the caller as request-time. The Supabase client used to
 * do that by reading cookies; a database in this process reads nothing from
 * the request, so without it Next would try to render pages at build time.
 */
export async function createClient(): Promise<Client> {
  await connection();
  return clientFor(await database());
}

export type Owner = { id: string; email: string | null };

/**
 * Whose Burg this is. There is exactly one person, and `auth.uid()` in SQL
 * gives the same answer (see the local auth migration).
 */
export async function getOwner(): Promise<Owner> {
  await connection();
  const db = await database();
  const { rows } = await db.query<Owner>("select id, email from auth.users order by created_at, id limit 1");
  const owner = rows[0];
  if (!owner) throw new Error("Burg's database has no owner; boot() should have made one.");
  return owner;
}

/** Called on shutdown so the files are left as a clean checkpoint, not a crash to recover from. */
export async function closeDatabase(): Promise<void> {
  const pending = store.__burgDatabase;
  store.__burgDatabase = undefined;
  const db = await pending?.catch(() => undefined);
  await db?.close();
}

/**
 * Open the database and make sure it has someone to belong to and somewhere
 * for them to land -- what the first sign-in used to do.
 */
async function boot(): Promise<PGlite> {
  const db = await openDatabase(dataDir());

  let { rows } = await db.query<Owner>("select id, email from auth.users order by created_at, id limit 1");
  if (rows.length === 0) {
    // `burg.handle_new_user` makes the profile from this row.
    ({ rows } = await db.query<Owner>(
      "insert into auth.users (email, raw_user_meta_data) values ($1, $2) returning id, email",
      ["you@burg.local", { full_name: "You" }],
    ));
  }
  const owner = rows[0]!;

  const { rows: cities } = await db.query("select 1 from public.cities where owner_id = $1 limit 1", [owner.id]);
  if (cities.length === 0) {
    try {
      await seedIdeaburg(clientFor(db), owner.id);
    } catch (error) {
      // A failed seed must not make the app unusable; the city page copes with none.
      console.error("[burg] seeding the first city failed", error);
    }
  }
  return db;
}
