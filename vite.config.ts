import { defineConfig } from "vite";

// base: "./" makes built asset paths relative so the game works when GitHub
// Pages serves it from a subpath (https://me-games.github.io/<slug>/).
export default defineConfig({
  base: "./",
});
