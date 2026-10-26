/**
 * Finish `.next/standalone` into something the desktop app can run on its own.
 *
 *   node desktop/prepare.mjs      # after `next build`; npm run desktop:build does both
 *
 * Next copies the server and the files it traces, and deliberately leaves out
 * `public/` and `.next/static/`, which a CDN would normally serve. There is no
 * CDN here, so they are copied in. Then the result is checked for the things
 * that would make the app fail on launch, or ship something it should not.
 */
import { cpSync, existsSync, readdirSync, rmSync } from "node:fs";
import path from "node:path";

const root = path.join(import.meta.dirname, "..");
const standalone = path.join(root, ".next", "standalone");

if (!existsSync(path.join(standalone, "server.js"))) {
  console.error("No .next/standalone/server.js. Run `next build` first (output: 'standalone').");
  process.exit(1);
}

cpSync(path.join(root, "public"), path.join(standalone, "public"), { recursive: true });
cpSync(path.join(root, ".next", "static"), path.join(standalone, ".next", "static"), { recursive: true });

// Next copies .env files into the standalone folder. .env.local holds keys for
// the hosted services this app no longer uses, and none of it belongs inside a
// bundle that gets copied around.
for (const name of readdirSync(standalone)) {
  if (name.startsWith(".env")) rmSync(path.join(standalone, name));
}
// The dev database must never be packaged, whatever the tracer decided.
rmSync(path.join(standalone, ".burg-data"), { recursive: true, force: true });

const missing = [
  "db/migrations/00000000000000_local_auth.sql",
  "node_modules/@electric-sql/pglite/dist/pglite.wasm",
  "node_modules/@electric-sql/pglite/dist/pglite.data",
  // Only a first launch needs it, which is exactly when nobody is watching.
  "node_modules/@electric-sql/pglite/dist/initdb.wasm",
  "node_modules/@electric-sql/pglite/dist/btree_gist.tar.gz",
].filter((file) => !existsSync(path.join(standalone, file)));

if (missing.length > 0) {
  console.error("The standalone build is missing files the app needs at runtime:");
  for (const file of missing) console.error(`  ${file}`);
  process.exit(1);
}

console.log(`Prepared ${path.relative(root, standalone)} for the desktop app.`);
