import { defineConfig } from "vite";

export default defineConfig({
  base: "/interlis-web-ide/",
  worker: {
    format: "es",
  },
  build: {
    target: "es2022",
    sourcemap: true
  }
});
