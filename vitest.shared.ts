import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

// Shared Vitest config. tsconfigPaths resolves "@muster/*" workspace
// imports to package source via tsconfig.base.json "paths" (extends-aware),
// so tests run against TS source with no build step.
export default defineConfig({
  plugins: [tsconfigPaths()],
  test: { globals: true, environment: "node" },
});
