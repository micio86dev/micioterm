import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // DOM environment so UI modules (tab bar, panels, panes) can be tested.
    // Pure logic tests run fine here too.
    environment: "happy-dom",
    include: ["src/**/*.test.ts"],
    exclude: ["src-tauri/**", "node_modules/**"],
    // A stray `.only` must fail the run, not silently skip the rest of the suite.
    allowOnly: false,
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: [
        "src/**/*.test.ts",
        "src/test/**", // shared test doubles
        "src/vite-env.d.ts",
      ],
      reporter: ["text", "text-summary"],
    },
  },
});
