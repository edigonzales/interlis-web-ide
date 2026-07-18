import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  base: "/interlis-web-ide/",
  // Emscripten resolves ilic.wasm relative to its generated module. Keeping the
  // module out of Vite's dev-only dependency bundle preserves that URL; the
  // production build rewrites it to the hashed asset automatically.
  optimizeDeps: {
    exclude: [
      "@ilic/compiler-wasm",
      "@ilic/language-service",
      "@ilic/monaco-adapter",
    ],
  },
  plugins: [
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["icon.svg"],
      manifest: {
        id: "/interlis-web-ide/",
        name: "INTERLIS Web IDE",
        short_name: "INTERLIS IDE",
        description: "Offline-first browser IDE for INTERLIS model development",
        start_url: "/interlis-web-ide/",
        scope: "/interlis-web-ide/",
        display: "standalone",
        background_color: "#181818",
        theme_color: "#181818",
        icons: [
          {
            src: "icon.svg",
            sizes: "any",
            type: "image/svg+xml",
            purpose: "any maskable",
          },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{html,js,css,wasm,svg,ttf}"],
        maximumFileSizeToCacheInBytes: 12 * 1024 * 1024,
        navigateFallback: "/interlis-web-ide/index.html",
      },
    }),
  ],
  worker: {
    format: "es",
  },
  build: {
    target: "es2022",
    sourcemap: false,
  },
});
