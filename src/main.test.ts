import { beforeEach, describe, expect, it, vi } from "vitest";

// main.ts runs on import; use doMock + resetModules so each test re-imports it
// fresh with its own App double.
describe("main entry", () => {
  beforeEach(() => {
    vi.resetModules();
    document.body.innerHTML = "";
  });

  it("boots the App on #root when present", async () => {
    const start = vi.fn().mockResolvedValue(undefined);
    const App = vi.fn(function () {
      return { start };
    });
    vi.doMock("./app", () => ({ App }));

    const root = document.createElement("div");
    root.id = "root";
    document.body.appendChild(root);

    await import("./main");

    expect(App).toHaveBeenCalledWith(root);
    expect(start).toHaveBeenCalledOnce();
  });

  it("does nothing when #root is missing", async () => {
    const App = vi.fn(function () {
      return { start: vi.fn().mockResolvedValue(undefined) };
    });
    vi.doMock("./app", () => ({ App }));

    await import("./main");

    expect(App).not.toHaveBeenCalled();
  });
});
