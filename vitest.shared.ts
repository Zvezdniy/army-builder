import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

// Shared Vitest config. tsconfigPaths resolves "@muster/*" workspace
// imports to package source via tsconfig.base.json "paths" (extends-aware),
// so tests run against TS source with no build step.
//
// Coverage is enforced at 100% across the engine's pure logic: every branch of
// the evaluator, resolver, and validation boundary is security- or
// correctness-relevant, so an untested line is a real gap, not noise. `pnpm test`
// runs with `--coverage`, so a drop below threshold fails the suite.
export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    environment: "node",
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/index.ts"],
      reporter: ["text", "html"],
      thresholds: { statements: 100, branches: 100, functions: 100, lines: 100 },
    },
  },
});
