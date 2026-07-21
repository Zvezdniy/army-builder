import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tsconfigPaths from "vite-tsconfig-paths";

// The production build is served from the GitHub Pages project path
// https://<owner>.github.io/army-builder/, so assets resolve under that base and
// `import.meta.env.BASE_URL` (the app's default catalogue base) points at the same
// origin's data. Local dev keeps `/` so the dev server stays at localhost:5173/.
export default defineConfig(({ command }) => ({
  base: command === "build" ? "/army-builder/" : "/",
  plugins: [react(), tsconfigPaths()],
}));
