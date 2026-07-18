import { defineConfig } from "vite";

export default defineConfig({
  base: "/interlis-web-ide/",
  build: {
    target: "es2022",
    sourcemap: true
  }
});
