import coreWebVitals from "eslint-config-next/core-web-vitals";
import typescript from "eslint-config-next/typescript";

// eslint-config-next ships native flat config as of Next 16; FlatCompat is no
// longer needed (and produces a circular-structure error when used here).
const config = [
  { ignores: [".next/**", "node_modules/**", "next-env.d.ts", "scripts/shots/**", "dist-desktop/**", ".burg-data/**"] },
  ...coreWebVitals,
  ...typescript,
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/consistent-type-imports": "error",
    },
  },
  // CommonJS on purpose (electron-builder's hooks), where require is the import.
  { files: ["**/*.cjs"], rules: { "@typescript-eslint/no-require-imports": "off" } },
];

export default config;
