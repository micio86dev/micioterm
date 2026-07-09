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
vi.mock("./pty-bridge", () => ({
  onPtyOutput: vi.fn().mockResolvedValue(() => {}),
  onPtyExit: vi.fn().mockResolvedValue(() => {}),
  ptySpawn: vi.fn().mockResolvedValue(undefined),
  ptyWrite: vi.fn().mockResolvedValue(undefined),
  ptyResize: vi.fn().mockResolvedValue(undefined),
  ptyKill: vi.fn().mockResolvedValue(undefined),
  ptyCwd: vi.fn().mockResolvedValue(null),
}));

import { Pane } from "./pane";
import { onPtyExit, onPtyOutput, ptyKill, ptyResize, ptySpawn, ptyWrite } from "./pty-bridge";

/** The mocked xterm Terminal instance a pane built, with the test hooks exposed. */
interface FakeTerminal {
  options: Record<string, unknown>;
  cols: number;
  rows: number;
  onDataCb?: (data: string) => void;
  onResizeCb?: (size: { cols: number; rows: number }) => void;
  keyHandler?: (event: KeyboardEvent) => boolean;
  hasSelection(): boolean;
  getSelection(): string;
  dispose(): void;
}

/** Reach into the pane's private xterm instance (all mocked, safe to poke). */
function term(pane: Pane): FakeTerminal {
  return (pane as unknown as { term: FakeTerminal }).term;
}

function chip(pane: Pane): HTMLDivElement {
  return pane.element.querySelector(".pane__name") as HTMLDivElement;
}

const writeText = vi.fn().mockResolvedValue(undefined);
const readText = vi.fn().mockResolvedValue("pasted");

beforeEach(() => {
  vi.clearAllMocks();
  writeText.mockResolvedValue(undefined);
  readText.mockResolvedValue("pasted");
  globalThis.ResizeObserver = class {
    observe() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
  Object.defineProperty(globalThis.navigator, "clipboard", {
    configurable: true,
    value: { writeText, readText },
  });
});

afterEach(() => {
  document.body.innerHTML = "";
});

describe("Pane constructor", () => {
  it("defaults the name to an empty string", () => {
    const pane = new Pane();
    expect(pane.name).toBe("");
  });

  it("takes the name from options", () => {
    const pane = new Pane({ name: "api" });
    expect(pane.name).toBe("api");
  });

  it("builds a .pane element carrying a .pane__name chip", () => {
    const pane = new Pane();
    expect(pane.element.classList.contains("pane")).toBe(true);
    expect(chip(pane)).not.toBeNull();
  });

  it('shows the ＋ placeholder when unnamed', () => {
    const pane = new Pane();
    expect(chip(pane).textContent).toBe("＋");
    expect(chip(pane).classList.contains("pane__name--empty")).toBe(true);
  });

  it("shows the name in the chip when set", () => {
    const pane = new Pane({ name: "web" });
    expect(chip(pane).textContent).toBe("web");
    expect(chip(pane).classList.contains("pane__name--empty")).toBe(false);
  });

  it("gives each pane a unique session id", () => {
    expect(new Pane().sessionId).not.toBe(new Pane().sessionId);
  });
});

describe("Pane.setName", () => {
  it("updates the chip text and fires onRename", () => {
    const pane = new Pane();
    const onRename = vi.fn();
    pane.onRename = onRename;

    pane.setName("db");

    expect(pane.name).toBe("db");
    expect(chip(pane).textContent).toBe("db");
    expect(onRename).toHaveBeenCalledTimes(1);
  });

  it("falls back to the ＋ placeholder when cleared", () => {
    const pane = new Pane({ name: "db" });
    pane.setName("");
    expect(chip(pane).textContent).toBe("＋");
    expect(chip(pane).classList.contains("pane__name--empty")).toBe(true);
  });
});

describe("Pane inline rename", () => {
  const dblclick = (el: HTMLElement) =>
    el.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, cancelable: true }));

  const input = (pane: Pane) =>
    pane.element.querySelector(".pane__name-input") as HTMLInputElement | null;

  const keydown = (el: HTMLElement, key: string) =>
    el.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));

  it("opens an input on double-click of the chip", () => {
    const pane = new Pane();
    dblclick(chip(pane));
    expect(input(pane)).not.toBeNull();
  });

  it("commits on Enter: sets the name and fires onRename once", () => {
    const pane = new Pane();
    const onRename = vi.fn();
    pane.onRename = onRename;

    dblclick(chip(pane));
    const field = input(pane)!;
    field.value = "  worker  ";
    keydown(field, "Enter");

    expect(pane.name).toBe("worker");
    expect(chip(pane).textContent).toBe("worker");
    expect(onRename).toHaveBeenCalledTimes(1);
  });

  it("cancels on Escape without renaming", () => {
    const pane = new Pane({ name: "keep" });
    const onRename = vi.fn();
    pane.onRename = onRename;

    dblclick(chip(pane));
    const field = input(pane)!;
    field.value = "discard";
    keydown(field, "Escape");

    expect(pane.name).toBe("keep");
    expect(chip(pane).textContent).toBe("keep");
    expect(onRename).not.toHaveBeenCalled();
  });

  it("settles once: Enter then blur only renames once", () => {
    const pane = new Pane();
    const onRename = vi.fn();
    pane.onRename = onRename;

    dblclick(chip(pane));
    const field = input(pane)!;
    field.value = "solo";
    keydown(field, "Enter");
    field.dispatchEvent(new FocusEvent("blur"));

    expect(onRename).toHaveBeenCalledTimes(1);
    expect(pane.name).toBe("solo");
  });
});

describe("Pane.applyStyle", () => {
  it("mutates the terminal options", () => {
    const pane = new Pane();
    const theme = { foreground: "#fff" };
    pane.applyStyle({
      fontFamily: "Fira Code",
      fontSize: 18,
      cursorBlink: false,
      theme,
    });

    const opts = term(pane).options;
    expect(opts.fontFamily).toBe("Fira Code");
    expect(opts.fontSize).toBe(18);
    expect(opts.cursorBlink).toBe(false);
    expect(opts.theme).toBe(theme);
  });

  it("ignores undefined fields", () => {
    const pane = new Pane();
    const before = { ...term(pane).options };
    pane.applyStyle({ fontSize: 20 });
    expect(term(pane).options.fontSize).toBe(20);
    expect(term(pane).options.fontFamily).toBe(before.fontFamily);
  });

  it("is a no-op after dispose", async () => {
    const pane = new Pane();
    await pane.dispose();
    pane.applyStyle({ fontSize: 99 });
    expect(term(pane).options.fontSize).not.toBe(99);
  });
});

describe("Pane.mount", () => {
  it("appends the element and wires the PTY streams", async () => {
    const pane = new Pane({ shell: "/bin/zsh" });
    const parent = document.createElement("div");

    await pane.mount(parent);

    expect(parent.contains(pane.element)).toBe(true);
    expect(onPtyOutput).toHaveBeenCalledWith(pane.sessionId, expect.any(Function));
    expect(onPtyExit).toHaveBeenCalledWith(pane.sessionId, expect.any(Function));
    expect(ptySpawn).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: pane.sessionId, shell: "/bin/zsh" }),
    );
  });

  it("forwards term data to ptyWrite and resizes to ptyResize", async () => {
    const pane = new Pane();
    await pane.mount(document.createElement("div"));

    term(pane).onDataCb?.("ls\n");
    expect(ptyWrite).toHaveBeenCalledWith(pane.sessionId, "ls\n");

    term(pane).onResizeCb?.({ cols: 120, rows: 40 });
    expect(ptyResize).toHaveBeenCalledWith(pane.sessionId, 120, 40);
  });
});

describe("Pane.dispose", () => {
  it("unsubscribes and kills the PTY", async () => {
    const unlisten = vi.fn();
    const exitUnlisten = vi.fn();
    vi.mocked(onPtyOutput).mockResolvedValueOnce(unlisten);
    vi.mocked(onPtyExit).mockResolvedValueOnce(exitUnlisten);

    const pane = new Pane();
    await pane.mount(document.createElement("div"));
    await pane.dispose();

    expect(unlisten).toHaveBeenCalledTimes(1);
    expect(exitUnlisten).toHaveBeenCalledTimes(1);
    expect(ptyKill).toHaveBeenCalledWith(pane.sessionId);
  });

  it("is idempotent", async () => {
    const pane = new Pane();
    await pane.mount(document.createElement("div"));
    await pane.dispose();
    await pane.dispose();
    expect(ptyKill).toHaveBeenCalledTimes(1);
  });
});

describe("Pane.handleKey (clipboard)", () => {
  const key = (pane: Pane, k: string, mods: Partial<KeyboardEvent> = {}) =>
    term(pane).keyHandler!({ type: "keydown", key: k, metaKey: true, ...mods } as KeyboardEvent);

  it("copies the selection on ⌘C", async () => {
    const pane = new Pane();
    const t = term(pane);
    vi.spyOn(t, "hasSelection").mockReturnValue(true);
    vi.spyOn(t, "getSelection").mockReturnValue("selected text");

    const result = key(pane, "c");

    expect(result).toBe(false);
    expect(writeText).toHaveBeenCalledWith("selected text");
  });

  it("does not intercept ⌘C without a selection", () => {
    const pane = new Pane();
    vi.spyOn(term(pane), "hasSelection").mockReturnValue(false);
    const result = key(pane, "c");
    expect(result).toBe(true);
    expect(writeText).not.toHaveBeenCalled();
  });

  it("blocks ⌘V keydown so the native paste event reaches xterm (no double-paste)", () => {
    // handleKey must return false to suppress xterm's raw keydown processing.
    // The actual paste goes through the browser's `paste` event → xterm onData →
    // ptyWrite, avoiding the macOS clipboard permission popup that caused double-paste.
    const pane = new Pane();

    const result = key(pane, "v");

    expect(result).toBe(false);
    expect(readText).not.toHaveBeenCalled();
  });

  it("lets non-meta keys through", () => {
    const pane = new Pane();
    expect(key(pane, "c", { metaKey: false })).toBe(true);
  });
});
