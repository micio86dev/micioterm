import { defineConfig } from "vite";

// Tauri expects a fixed dev port and does not want Vite to clear the screen so
// Rust compiler errors stay visible. See https://v2.tauri.app/start/frontend/vite/
const host = process.env.TAURI_DEV_HOST;

export default defineConfig({
  clearScreen: false,
  server: {
    host: host || false,
    port: 1420,
    strictPort: true,
    hmr: host
      ? { protocol: "ws", host, port: 1421 }
      : undefined,
    watch: {
      // Tauri sources are watched by cargo, not Vite.
      ignored: ["**/src-tauri/**"],
    },
  },
  // Produce assets Safari/WKWebView on the supported macOS versions can run.
  // `minify: true` uses Vite 8's default (oxc) minifier; disabled in debug so
  // Tauri debug builds stay readable.
  build: {
    target: "es2021",
    minify: !process.env.TAURI_ENV_DEBUG,
    sourcemap: !!process.env.TAURI_ENV_DEBUG,
  },
});
