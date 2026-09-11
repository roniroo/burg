import type { NextConfig } from "next";

const config: NextConfig = {
  reactStrictMode: true,
  // A stray package-lock.json above this directory makes Turbopack infer the
  // wrong workspace root; pin it to the repo.
  turbopack: { root: import.meta.dirname },
  typedRoutes: true,
  // No `images.remotePatterns`, deliberately. Allowing `hostname: "**"` turns
  // /_next/image into an open image proxy: the route is excluded from the auth
  // matcher in proxy.ts, so anyone could make this server fetch any https URL
  // and re-serve it from our domain, on our bandwidth and our IP. Nothing here
  // needs it -- the one place remote images are shown, the newsstand's link
  // cards, deliberately uses a plain <img> at 96px rather than the optimiser,
  // and the /api/og route the old comment cited does not exist. With no
  // patterns configured the optimiser refuses every remote URL.
};

export default config;
