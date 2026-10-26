import { defineConfig } from "vitest/config";

export default defineConfig({
  // The app's `@/` imports, so a test can reach modules that use them.
  resolve: { alias: { "@": import.meta.dirname } },
  test: {
    // The pure modules (iso, roads, placement, daylight) are the main tested
    // units: no DOM, no React, no network. lib/db is the exception -- it runs
    // a real Postgres in memory, because the translation is only right if
    // Postgres agrees with it.
    include: ["lib/**/*.test.ts"],
    environment: "node",
  },
});
