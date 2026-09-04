import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // The pure modules (iso, roads, placement, daylight) are the only tested
    // units: no DOM, no React, no network.
    include: ["lib/**/*.test.ts"],
    environment: "node",
  },
});
