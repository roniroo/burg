import type { NextConfig } from "next";

const config: NextConfig = {
  reactStrictMode: true,
  // A stray package-lock.json above this directory makes Turbopack infer the
  // wrong workspace root; pin it to the repo.
  turbopack: { root: import.meta.dirname },
  typedRoutes: true,
  // The desktop app ships `.next/standalone`: server.js plus only the files it
  // traces, which is what makes the app bundle small enough to be sensible.
  output: "standalone",
  // PGlite loads its Postgres build (.wasm, .data, and the btree_gist tarball)
  // from beside its own files at runtime, so it has to stay a real package in
  // node_modules rather than be folded into a server chunk.
  serverExternalPackages: ["@electric-sql/pglite"],
  // Read with fs at boot, so nothing imports them for the tracer to find.
  outputFileTracingIncludes: {
    "/*": ["./db/migrations/*.sql"],
  },
  // Sprite uploads are server actions, and a PNG may be up to 5 MB
  // (lib/custom-sprites.ts); the default limit is 1 MB. Room for the
  // multipart overhead on top.
  experimental: {
    serverActions: { bodySizeLimit: "6mb" },
  },
  // No `images.remotePatterns`, deliberately. Allowing `hostname: "**"` turns
  // /_next/image into an open image proxy: the route is excluded from the
  // matcher in proxy.ts, so any page could make this server fetch any https
  // URL and re-serve it. Nothing here needs it -- the one place remote images
  // are shown, the newsstand's link cards, deliberately uses a plain <img> at
  // 96px rather than the optimiser. With no patterns configured the optimiser
  // refuses every remote URL.
};

export default config;
