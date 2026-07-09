import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// --- xterm + addon mocks (hoisted to the top of the module) ---------------
vi.mock("@xterm/xterm/css/xterm.css", () => ({}));
vi.mock("@xterm/xterm", () => {
  class Terminal {
    options: Record<string, unknown> = {};
    cols = 80;
    rows = 24;
    onDataCb?: (data: string) => void;
    onResizeCb?: (size: { cols: number; rows: number }) => void;
    keyHandler?: (event: KeyboardEvent) => boolean;
    constructor(o: Record<string, unknown>) {
      this.options = { ...o };
    }
    loadAddon() {}
    open(el: HTMLElement) {
      el.innerHTML = "<textarea></textarea>";
    }
    focus() {}
    clear() {}
    write() {}
    onData(cb: (data: string) => void) {
      this.onDataCb = cb;
    }
    onResize(cb: (size: { cols: number; rows: number }) => void) {
      this.onResizeCb = cb;
    }
    attachCustomKeyEventHandler(cb: (event: KeyboardEvent) => boolean) {
      this.keyHandler = cb;
    }
    hasSelection() {
      return false;
    }
    getSelection() {
      return "";
    }
    dispose() {}
  }
  return { Terminal };
});
vi.mock("@xterm/addon-fit", () => ({ FitAddon: class { fit() {} } }));
vi.mock("@xterm/addon-web-links", () => ({ WebLinksAddon: class {} }));
vi.mock("@xterm/addon-webgl", () => ({
  WebglAddon: class {
    onContextLoss() {}
    dispose() {}
  },
}));
vi.mock("@xterm/addon-canvas", () => ({ CanvasAddon: class {} }));
vi.mock("../terminal/pty-bridge", () => ({
  onPtyOutput: vi.fn().mockResolvedValue(() => {}),
  onPtyExit: vi.fn().mockResolvedValue(() => {}),
  ptySpawn: vi.fn().mockResolvedValue(undefined),
  ptyWrite: vi.fn().mockResolvedValue(undefined),
  ptyResize: vi.fn().mockResolvedValue(undefined),
  ptyKill: vi.fn().mockResolvedValue(undefined),
  ptyCwd: vi.fn().mockResolvedValue(null),
}));

import { Pane } from "../terminal/pane";
import { PaneGrid, type PaneGridCallbacks, type PaneGridRestore } from "./pane-grid";

function makeCallbacks() {
  return {
    onEmpty: vi.fn(),
    onSplitRejected: vi.fn(),
    onChange: vi.fn(),
  } satisfies PaneGridCallbacks;
}

/** The live Pane instances the grid owns (all built on the mocked xterm). */
function panesOf(grid: PaneGrid): Map<string, Pane> {
  return (grid as unknown as { panes: Map<string, Pane> }).panes;
}

beforeEach(() => {
  vi.clearAllMocks();
  globalThis.ResizeObserver = class {
    observe() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});

afterEach(() => {
  document.body.innerHTML = "";
});

describe("PaneGrid constructor + start", () => {
  it("creates the first pane", () => {
    const grid = new PaneGrid(makeCallbacks());
    expect(panesOf(grid).size).toBe(1);
  });

  it("mounts the first pane into its own element on start", async () => {
    const grid = new PaneGrid(makeCallbacks());
    await grid.start();
    const first = [...panesOf(grid).values()][0];
    expect(grid.element.contains(first.element)).toBe(true);
  });
});

describe("PaneGrid.splitActive", () => {
  it("adds a pane and fires onChange", async () => {
    const cb = makeCallbacks();
    const grid = new PaneGrid(cb);
    await grid.start();

    await grid.splitActive("vertical");

    expect(panesOf(grid).size).toBe(2);
    expect(cb.onChange).toHaveBeenCalledTimes(1);
    expect(cb.onSplitRejected).not.toHaveBeenCalled();
  });

  it("grows up to the 4-pane cap", async () => {
    const grid = new PaneGrid(makeCallbacks());
    await grid.start();
    await grid.splitActive("vertical");
    await grid.splitActive("vertical");
    await grid.splitActive("vertical");
    expect(panesOf(grid).size).toBe(4);
  });

  it("rejects a split at the cap and does not add a pane", async () => {
    const cb = makeCallbacks();
    const grid = new PaneGrid(cb);
    await grid.start();
    await grid.splitActive("vertical");
    await grid.splitActive("vertical");
    await grid.splitActive("vertical");
    cb.onSplitRejected.mockClear();
    cb.onChange.mockClear();

    await grid.splitActive("vertical");

    expect(panesOf(grid).size).toBe(4);
    expect(cb.onSplitRejected).toHaveBeenCalledTimes(1);
    expect(cb.onChange).not.toHaveBeenCalled();
  });
});

describe("PaneGrid.snapshot", () => {
  it("reflects the current layout", async () => {
    const grid = new PaneGrid(makeCallbacks());
    await grid.start();
    await grid.splitActive("horizontal");

    const snap = grid.snapshot();
    const panes = [...panesOf(grid).values()];

    expect(snap.orientation).toBe("horizontal");
    expect(snap.panes).toHaveLength(2);
    // The freshly-split pane is active — it's the second in the ordered list.
    expect(snap.activeIndex).toBe(1);
    expect(snap.panes.map((p) => p.sessionId)).toEqual(panes.map((p) => p.sessionId));
  });

  it("carries pane names", async () => {
    const grid = new PaneGrid(makeCallbacks());
    await grid.start();
    [...panesOf(grid).values()][0].setName("main");

    const snap = grid.snapshot();
    expect(snap.panes[0].name).toBe("main");
  });
});

describe("PaneGrid restore", () => {
  it("rebuilds the saved panes with names and focuses the active one", async () => {
    const restore: PaneGridRestore = {
      panes: [
        { cwd: "/a", name: "alpha" },
        { cwd: "/b", name: "beta" },
        { cwd: "/c", name: "gamma" },
      ],
      orientation: "vertical",
      activeIndex: 1,
    };
    const grid = new PaneGrid(makeCallbacks(), {}, restore);

    const focusSpy = vi.spyOn(Pane.prototype, "focus");
    await grid.start();

    const panes = [...panesOf(grid).values()];
    expect(panes).toHaveLength(3);
    expect(panes.map((p) => p.name)).toEqual(["alpha", "beta", "gamma"]);

    // Focus lands on the restored active index (the "beta" pane).
    expect(focusSpy).toHaveBeenLastCalledWith();
    const snap = grid.snapshot();
    expect(snap.activeIndex).toBe(1);
    focusSpy.mockRestore();
  });
});

describe("PaneGrid.closeActivePane", () => {
  it("removes the active pane and keeps the tab open", async () => {
    const cb = makeCallbacks();
    const grid = new PaneGrid(cb);
    await grid.start();
    await grid.splitActive("vertical");
    cb.onChange.mockClear();

    grid.closeActivePane();

    expect(panesOf(grid).size).toBe(1);
    expect(cb.onEmpty).not.toHaveBeenCalled();
    expect(cb.onChange).toHaveBeenCalledTimes(1);
  });

  it("calls onEmpty when the last pane closes", async () => {
    const cb = makeCallbacks();
    const grid = new PaneGrid(cb);
    await grid.start();

    grid.closeActivePane();

    expect(panesOf(grid).size).toBe(0);
    expect(cb.onEmpty).toHaveBeenCalledTimes(1);
  });
});

describe("PaneGrid.clearActive", () => {
  it("clears the active pane's terminal", async () => {
    const grid = new PaneGrid(makeCallbacks());
    await grid.start();
    const active = [...panesOf(grid).values()][0];
    const clearSpy = vi.spyOn(active, "clear");

    grid.clearActive();

    expect(clearSpy).toHaveBeenCalledTimes(1);
  });
});

describe("PaneGrid focus follows selection", () => {
  it("selects the pane under a mousedown", async () => {
    const cb = makeCallbacks();
    const grid = new PaneGrid(cb);
    await grid.start();
    await grid.splitActive("vertical");
    cb.onChange.mockClear();

    const [firstPane] = [...panesOf(grid).values()];
    const focusSpy = vi.spyOn(firstPane, "focus");

    firstPane.element.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));

    expect(focusSpy).toHaveBeenCalledTimes(1);
    expect(cb.onChange).toHaveBeenCalledTimes(1);
    expect(grid.snapshot().activeIndex).toBe(0);
  });

  it("ignores a mousedown on the already-active pane", async () => {
    const cb = makeCallbacks();
    const grid = new PaneGrid(cb);
    await grid.start();
    await grid.splitActive("vertical");
    cb.onChange.mockClear();

    // The second (freshly split) pane is already active.
    const activePane = [...panesOf(grid).values()][1];
    activePane.element.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));

    expect(cb.onChange).not.toHaveBeenCalled();
  });
});

describe("PaneGrid focus navigation", () => {
  it("cycleActive moves focus to the next pane and fires onChange", async () => {
    const cb = makeCallbacks();
    const grid = new PaneGrid(cb);
    await grid.start();
    await grid.splitActive("vertical");
    cb.onChange.mockClear();

    grid.cycleActive(1);

    // From the second (active) pane, +1 wraps to the first.
    expect(grid.snapshot().activeIndex).toBe(0);
    expect(cb.onChange).toHaveBeenCalledTimes(1);
  });

  it("cycleActive is a no-op with a single pane", async () => {
    const cb = makeCallbacks();
    const grid = new PaneGrid(cb);
    await grid.start();
    cb.onChange.mockClear();

    grid.cycleActive(-1);
    expect(cb.onChange).not.toHaveBeenCalled();
  });

  it("focusActive moves to a spatial neighbor", async () => {
    const cb = makeCallbacks();
    const grid = new PaneGrid(cb);
    await grid.start();
    await grid.splitActive("vertical"); // two panes side by side; right is active
    cb.onChange.mockClear();

    grid.focusActive("left");

    expect(grid.snapshot().activeIndex).toBe(0);
    expect(cb.onChange).toHaveBeenCalledTimes(1);
  });

  it("focusActive is a no-op when there is no neighbor", async () => {
    const cb = makeCallbacks();
    const grid = new PaneGrid(cb);
    await grid.start();
    await grid.splitActive("vertical");
    cb.onChange.mockClear();

    grid.focusActive("right"); // already on the rightmost pane
    expect(cb.onChange).not.toHaveBeenCalled();
  });

  it("focus() delegates to the active pane", async () => {
    const grid = new PaneGrid(makeCallbacks());
    await grid.start();
    const active = [...panesOf(grid).values()][0];
    const spy = vi.spyOn(active, "focus");

    grid.focus();
    expect(spy).toHaveBeenCalledTimes(1);
  });
});

describe("PaneGrid.dispose", () => {
  it("disposes every pane and detaches its element", async () => {
    const grid = new PaneGrid(makeCallbacks());
    await grid.start();
    await grid.splitActive("vertical");
    const spies = [...panesOf(grid).values()].map((p) => vi.spyOn(p, "dispose"));
    document.body.appendChild(grid.element);

    await grid.dispose();

    for (const spy of spies) {
      expect(spy).toHaveBeenCalledTimes(1);
    }
    expect(document.body.contains(grid.element)).toBe(false);
  });
});

describe("PaneGrid.applyStyleAll", () => {
  it("applies the style to every current pane", async () => {
    const grid = new PaneGrid(makeCallbacks());
    await grid.start();
    await grid.splitActive("vertical");

    const spies = [...panesOf(grid).values()].map((p) => vi.spyOn(p, "applyStyle"));
    const style = { fontSize: 22 };
    grid.applyStyleAll(style);

    for (const spy of spies) {
      expect(spy).toHaveBeenCalledWith(style);
    }
  });

  it("is inherited by panes created after the style change", async () => {
    const grid = new PaneGrid(makeCallbacks());
    await grid.start();
    grid.applyStyleAll({ fontSize: 30 });

    await grid.splitActive("vertical");

    const newest = [...panesOf(grid).values()][1];
    expect((newest as unknown as { options: { fontSize: number } }).options.fontSize).toBe(30);
  });
});
