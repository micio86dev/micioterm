import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Layout/tab/config logic is pure — no DOM needed. Panes that touch the
    // DOM or Tauri IPC are excluded from unit tests and verified manually.
    environment: "node",
    include: ["src/**/*.test.ts"],
    exclude: ["src-tauri/**", "node_modules/**"],
    // A stray `.only` must fail the run, not silently skip the rest of the suite.
    allowOnly: false,
  },
});
