/**
 * electron-builder hook: put the standalone server inside Burg.app.
 *
 * Done here, before signing, instead of with `extraResources`, because
 * electron-builder's copier treats anything named node_modules as its own
 * business: it skipped the server's node_modules entirely, and its default
 * filters would strip files from the ones it did copy. This is a plain copy
 * of `.next/standalone`, symlinks kept as they are -- Next links its external
 * packages (PGlite) from `.next/node_modules` with relative symlinks that
 * still resolve inside the bundle.
 */
const { cpSync, existsSync, rmSync } = require("node:fs");
const path = require("node:path");

exports.default = async function afterPack(context) {
  const standalone = path.join(__dirname, "..", ".next", "standalone");
  if (!existsSync(path.join(standalone, "server.js"))) {
    throw new Error("No .next/standalone/server.js; run `npm run desktop:build` first.");
  }

  const app = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  const server = path.join(app, "Contents", "Resources", "server");
  rmSync(server, { recursive: true, force: true });
  cpSync(standalone, server, { recursive: true, verbatimSymlinks: true });
};
