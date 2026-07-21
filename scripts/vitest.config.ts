import { defineConfig } from "vitest/config";

// Build-pipeline scripts get their own Vitest project: node env, NO coverage
// gate (they are glue, not the engine's 100%-covered logic). Kept out of
// `turbo run test`, which stays package-scoped, so this never touches the
// engine's 100% threshold.
export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["scripts/**/*.test.mjs"],
  },
});
