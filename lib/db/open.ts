import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist";

/**
 * Burg's database: Postgres compiled to WebAssembly, running inside this
 * process and keeping its files in one directory.
 *
 * It is the same Postgres the hosted project ran, so `db/migrations/` applies
 * unchanged -- triggers, full-text search, and the lot exclusion constraint
 * that needs `btree_gist`. What it is not is a server: one process opens a
 * data directory at a time, and queries from that process are serialised.
 * For one person's city that is the right trade.
 */

/** Read at call time, not import time, so the standalone build finds them beside server.js. */
function migrationsDir(): string {
  return path.join(/* turbopackIgnore: true */ process.cwd(), "db", "migrations");
}

/**
 * Open (creating if need be) the database in `dataDir`, and bring its schema
 * up to date. No `dataDir` means in memory, which is what the tests use.
 */
export async function openDatabase(dataDir?: string): Promise<PGlite> {
  const db = await PGlite.create({ dataDir, extensions: { btree_gist } });
  // PGlite starts in the machine's zone. Supabase ran in UTC, and every
  // timestamp the app has ever stored or compared assumed it.
  await db.exec("set timezone to 'UTC'");
  await migrate(db);
  return db;
}

/**
 * Apply every migration not yet recorded, in filename order, each in its own
 * transaction so a failure leaves the database at the last good version
 * rather than halfway through a file.
 */
export async function migrate(db: PGlite, dir = migrationsDir()): Promise<string[]> {
  await db.exec(`
    create schema if not exists local;
    create table if not exists local.migrations (
      version    text primary key,
      applied_at timestamptz not null default now()
    );
  `);

  const { rows } = await db.query<{ version: string }>("select version from local.migrations");
  const applied = new Set(rows.map((r) => r.version));

  const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();
  const ran: string[] = [];
  for (const file of files) {
    const version = file.replace(/\.sql$/, "");
    if (applied.has(version)) continue;

    const sql = await readFile(path.join(dir, file), "utf8");
    await db.transaction(async (tx) => {
      await tx.exec(sql);
      await tx.query("insert into local.migrations (version) values ($1)", [version]);
    });
    ran.push(version);
  }
  return ran;
}
