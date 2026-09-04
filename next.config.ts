import type { NextConfig } from "next";

const config: NextConfig = {
  reactStrictMode: true,
  // A stray package-lock.json above this directory makes Turbopack infer the
  // wrong workspace root; pin it to the repo.
  turbopack: { root: import.meta.dirname },
  typedRoutes: true,
  images: {
    // Kiosk links render remote OpenGraph images; they are fetched through
    // /api/og and stored as absolute URLs, so any https host is possible.
    remotePatterns: [{ protocol: "https", hostname: "**" }],
  },
};

export default config;
