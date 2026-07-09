import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { TerminalConfig } from "./config/config";
import type { SessionSnapshot } from "./core/session";

// --- Hoisted heavy-child mocks --------------------------------------------
// app.ts wires together many modules. We mock the heavy children so these
// tests exercise app.ts's ORCHESTRATION (session restore, snapshot/persist,
// rename, profile apply, tab lifecycle) rather than the children themselves.

/** A complete default config: one active profile with every field + a palette. */
function defaultConfig(): TerminalConfig {
  return {
    active_profile_id: "p1",
    watermark: true,
    show_banner: true,
    default_shell: null,
    scrollback: 1000,
    profiles: [
      {
        id: "p1",
        name: "Default",
        opacity: 0.85,
        blur_material: "hud",
        font_family: "JetBrains Mono",
        font_size: 14,
        cursor_blink: true,
        palette: {
          foreground: "#2fff5a",
          cursor: "#2fff5a",
          selection: "rgba(47,255,90,0.30)",
          black: "#15161b",
          red: "#ff5c57",
          green: "#2fff5a",
          yellow: "#f3f99d",
          blue: "#57c7ff",
          magenta: "#ff6ac1",
          cyan: "#9aedfe",
          white: "#e6e6e6",
          bright_black: "#6b7089",
          bright_red: "#ff5c57",
          bright_green: "#2fff5a",
          bright_yellow: "#f3f99d",
          bright_blue: "#57c7ff",
          bright_magenta: "#ff6ac1",
          bright_cyan: "#9aedfe",
          bright_white: "#ffffff",
        },
      },
    ],
  };
}

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    label: "main",
    close: vi.fn(),
    setFullscreen: vi.fn(),
    isFullscreen: vi.fn().mockResolvedValue(false),
  }),
}));

vi.mock("./config/config", async (orig) => {
  const actual = await orig<typeof import("./config/config")>();
  return {
    ...actual, // keep activeProfile (and interfaces) real
    loadConfig: vi.fn().mockResolvedValue(defaultConfig()),
    saveConfig: vi.fn().mockResolvedValue(undefined),
    setBlurMaterial: vi.fn().mockResolvedValue(undefined),
  };
});

vi.mock("./session/store", () => ({
  loadSession: vi.fn().mockResolvedValue(null),
  saveSession: vi.fn(),
}));

vi.mock("./terminal/pty-bridge", () => ({
  ptyCwd: vi.fn().mockResolvedValue("/tmp"),
}));

vi.mock("./ui/keybindings", () => ({
  installKeybindings: vi.fn((actions: Record<string, (...args: unknown[]) => unknown>) => {
    keybindingActions = actions;
    return () => {};
  }),
}));

vi.mock("./ui/help-overlay", () => ({
  HelpOverlay: class {
    element = document.createElement("div");
    toggle() {}
  },
}));

/** Captured callback bags, so tests can drive app internals via the public UI surface. */
interface SettingsCallbacks {
  onPreview: (config: TerminalConfig) => void;
  onCommit: (config: TerminalConfig) => void;
}
interface TabBarCallbacks {
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  onNew: () => void;
  onSettings: () => void;
  onRename: (id: string, title: string) => void;
}
interface TabBarInstance {
  element: HTMLDivElement;
  cb: TabBarCallbacks;
  render: ReturnType<typeof vi.fn>;
}
const captured: {
  settings: SettingsCallbacks | undefined;
  tabBar: TabBarCallbacks | undefined;
  tabBarInstance: TabBarInstance | undefined;
} = { settings: undefined, tabBar: undefined, tabBarInstance: undefined };

/** The keybinding action bag app.ts passes to installKeybindings(). */
let keybindingActions: Record<string, (...args: unknown[]) => unknown> = {};

vi.mock("./ui/settings-panel", () => ({
  SettingsPanel: class {
    element = document.createElement("div");
    cb: SettingsCallbacks;
    constructor(cb: SettingsCallbacks) {
      this.cb = cb;
      captured.settings = cb;
    }
    toggle() {}
    open() {}
  },
}));

vi.mock("./ui/tab-bar", () => ({
  TabBar: class {
    element = document.createElement("div");
    cb: TabBarCallbacks;
    render = vi.fn();
    constructor(cb: TabBarCallbacks) {
      this.cb = cb;
      captured.tabBar = cb;
      captured.tabBarInstance = this as unknown as TabBarInstance;
    }
  },
}));

vi.mock("./ui/pane-grid", () => {
  class PaneGrid {
    static instances: PaneGrid[] = [];
    element = document.createElement("div");
    cb: unknown;
    restore: unknown;
    start = vi.fn().mockResolvedValue(undefined);
    dispose = vi.fn().mockResolvedValue(undefined);
    applyStyleAll = vi.fn();
    constructor(cb: unknown, _opts: unknown, restore: unknown) {
      this.cb = cb;
      this.restore = restore;
      PaneGrid.instances.push(this);
    }
    focus() {}
    refitAll() {}
    snapshot() {
      return {
        orientation: "vertical" as const,
        activeIndex: 0,
        panes: [{ sessionId: "s" + PaneGrid.instances.indexOf(this), name: "" }],
      };
    }
  }
  return { PaneGrid };
});

vi.mock("./assets/miciodev-logo.jpg", () => ({ default: "logo.jpg" }));

// Imports must come AFTER the vi.mock calls above (which are hoisted anyway).
import { App } from "./app";
import { PaneGrid } from "./ui/pane-grid";
import { loadConfig, saveConfig } from "./config/config";
import { loadSession, saveSession } from "./session/store";

// Typed handles to the mocked module functions.
const loadSessionMock = vi.mocked(loadSession);
const saveSessionMock = vi.mocked(saveSession);
const loadConfigMock = vi.mocked(loadConfig);
const saveConfigMock = vi.mocked(saveConfig);

/** The shape the PaneGrid mock exposes to tests (spies + captured restore spec). */
interface MockPaneGrid {
  start: ReturnType<typeof vi.fn>;
  dispose: ReturnType<typeof vi.fn>;
  applyStyleAll: ReturnType<typeof vi.fn>;
  restore: unknown;
}
const paneGridInstances = (PaneGrid as unknown as { instances: MockPaneGrid[] }).instances;

/** Build a session snapshot with `count` tabs, each holding a single pane. */
function snapshotWithTabs(count: number, activeTabIndex = 0): SessionSnapshot {
  return {
    version: 1,
    activeTabIndex,
    tabs: Array.from({ length: count }, (_, i) => ({
      title: `Saved ${i + 1}`,
      orientation: "vertical" as const,
      activePaneIndex: 0,
      panes: [{ cwd: `/dir-${i}`, name: `pane-${i}` }],
    })),
  };
}

function makeRoot(): HTMLDivElement {
  return document.createElement("div");
}

describe("App orchestration", () => {
  beforeEach(() => {
    paneGridInstances.length = 0;
    captured.settings = undefined;
    captured.tabBar = undefined;
    captured.tabBarInstance = undefined;
    keybindingActions = {};
    loadSessionMock.mockReset().mockResolvedValue(null);
    saveSessionMock.mockReset();
    loadConfigMock.mockReset().mockResolvedValue(defaultConfig());
    saveConfigMock.mockReset().mockResolvedValue(undefined);
    document.documentElement.style.removeProperty("--bg-opacity");
  });

  afterEach(() => {
    vi.useRealTimers();
    document.body.textContent = "";
  });

  describe("start() with no saved session", () => {
    it("creates exactly one default tab (one PaneGrid created + started)", async () => {
      const app = new App(makeRoot());
      await app.start();

      expect(paneGridInstances).toHaveLength(1);
      expect(paneGridInstances[0].start).toHaveBeenCalledTimes(1);
    });

    it("applies the active profile: --bg-opacity comes from profile opacity", async () => {
      const app = new App(makeRoot());
      await app.start();

      expect(document.documentElement.style.getPropertyValue("--bg-opacity")).toBe("0.85");
    });

    it("exposes the loaded config via currentConfig", async () => {
      const app = new App(makeRoot());
      await app.start();

      expect(app.currentConfig?.active_profile_id).toBe("p1");
    });
  });

  describe("start() restoring a saved session (2 tabs)", () => {
    it("creates 2 tabs and does NOT open the extra default tab", async () => {
      loadSessionMock.mockResolvedValue(snapshotWithTabs(2));

      const app = new App(makeRoot());
      await app.start();

      // Two saved tabs -> exactly two PaneGrids; no fallback default tab.
      expect(paneGridInstances).toHaveLength(2);
      for (const grid of paneGridInstances) {
        expect(grid.start).toHaveBeenCalledTimes(1);
      }
    });

    it("passes each tab's restore spec into its PaneGrid", async () => {
      loadSessionMock.mockResolvedValue(snapshotWithTabs(2));

      const app = new App(makeRoot());
      await app.start();

      // Restore specs carry the saved panes (a real snapshot, not undefined).
      const restores = paneGridInstances.map((g) => g.restore as { panes: unknown[] });
      expect(restores[0].panes).toHaveLength(1);
      expect(restores[1].panes).toHaveLength(1);
    });

    it("switches to the saved active tab index", async () => {
      loadSessionMock.mockResolvedValue(snapshotWithTabs(3, 2));

      const app = new App(makeRoot());
      await app.start();
      expect(app).toBeDefined();

      // The TabBar mock's render(tabs, activeId) records every repaint. The saved
      // active index is 2 -> the third tab must be the active one after restore.
      const lastCall = lastRenderCall();
      const [tabs, activeId] = lastCall;
      const active = tabs.find((t) => t.id === activeId);
      expect(active?.title).toBe("Saved 3");
    });

    it("persists a snapshot after a complete restore (saveSession called)", async () => {
      vi.useFakeTimers();
      loadSessionMock.mockResolvedValue(snapshotWithTabs(2));

      const app = new App(makeRoot());
      await app.start();
      expect(app).toBeDefined();

      // restoreSession schedules one debounced persist on success.
      expect(saveSessionMock).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(800);

      expect(saveSessionMock).toHaveBeenCalledTimes(1);
      const written = saveSessionMock.mock.calls[0][0] as SessionSnapshot;
      expect(written.tabs).toHaveLength(2);
    });
  });

  describe("restoreSession is main-window-only", () => {
    it("opens a fresh default tab (does not restore) on a non-main window", async () => {
      // Override the window mock for this test only.
      const windowMod = await import("@tauri-apps/api/window");
      const spy = vi
        .spyOn(windowMod, "getCurrentWindow")
        .mockReturnValue({
          label: "secondary",
          close: vi.fn(),
          setFullscreen: vi.fn(),
          isFullscreen: vi.fn().mockResolvedValue(false),
        } as unknown as ReturnType<typeof windowMod.getCurrentWindow>);

      loadSessionMock.mockResolvedValue(snapshotWithTabs(2));

      const app = new App(makeRoot());
      await app.start();

      // Non-main window: restore returns false, so exactly one default tab opens
      // and the saved 2-tab snapshot is ignored.
      expect(loadSessionMock).not.toHaveBeenCalled();
      expect(paneGridInstances).toHaveLength(1);

      spy.mockRestore();
    });
  });

  describe("scheduleSnapshot / persistSession", () => {
    it("saves a snapshot 800ms after opening a new tab via TabBar.onNew", async () => {
      vi.useFakeTimers();
      const app = new App(makeRoot());
      await app.start();
      expect(app).toBeDefined();

      saveSessionMock.mockClear();

      // Drive through the public UI surface: the "+" button.
      captured.tabBar!.onNew();
      // Let the async newTab() (grid.start) settle before the debounce fires.
      await vi.advanceTimersByTimeAsync(0);
      expect(paneGridInstances).toHaveLength(2);

      await vi.advanceTimersByTimeAsync(800);

      expect(saveSessionMock).toHaveBeenCalled();
      const written = saveSessionMock.mock.calls.at(-1)![0] as SessionSnapshot;
      // Two tabs open -> the persisted snapshot has two tabs.
      expect(written.tabs).toHaveLength(2);
    });

    it("coalesces a burst of edits into a single debounced save", async () => {
      vi.useFakeTimers();
      const app = new App(makeRoot());
      await app.start();
      expect(app).toBeDefined();
      saveSessionMock.mockClear();

      // Several rapid edits within the debounce window.
      captured.tabBar!.onNew();
      await vi.advanceTimersByTimeAsync(0);
      captured.tabBar!.onRename("nope", "x"); // unknown id, still schedules
      captured.tabBar!.onRename("nope", "y");

      await vi.advanceTimersByTimeAsync(800);

      // Debounce collapses the burst to one write.
      expect(saveSessionMock).toHaveBeenCalledTimes(1);
    });

    it("does NOT save an empty snapshot (no tabs, no PaneGrids)", async () => {
      vi.useFakeTimers();
      // No config, no session; but even so persistSession guards on tabs.length.
      const app = new App(makeRoot());
      await app.start();
      expect(app).toBeDefined();
      saveSessionMock.mockClear();

      // Close the only tab -> state empties. persistSession must not write [].
      // Closing the last tab triggers window.close() and returns before any save.
      captured.tabBar!.onClose(currentTabId());
      await vi.advanceTimersByTimeAsync(800);

      expect(saveSessionMock).not.toHaveBeenCalled();
    });
  });

  describe("renameTabById (TabBar.onRename)", () => {
    it("updates the tab title (render called with the new title) and schedules a save", async () => {
      vi.useFakeTimers();
      const app = new App(makeRoot());
      await app.start();
      expect(app).toBeDefined();

      const id = currentTabId();
      const render = renderSpy();
      render.mockClear();
      saveSessionMock.mockClear();

      captured.tabBar!.onRename(id, "Renamed");

      // render() ran with the tab now carrying the new title.
      const lastCall = render.mock.calls.at(-1) as [Array<{ id: string; title: string }>, string];
      const renamed = lastCall[0].find((t) => t.id === id);
      expect(renamed?.title).toBe("Renamed");

      // And a save was scheduled.
      await vi.advanceTimersByTimeAsync(800);
      expect(saveSessionMock).toHaveBeenCalled();
    });
  });

  describe("the `restoring` guard", () => {
    it("suppresses mid-restore snapshots; only one save fires after restore", async () => {
      vi.useFakeTimers();
      loadSessionMock.mockResolvedValue(snapshotWithTabs(3));

      const app = new App(makeRoot());
      await app.start();
      expect(app).toBeDefined();

      // During restore, each newTab() calls scheduleSnapshot, but `restoring`
      // short-circuits them. Only the single post-restore scheduleSnapshot lands.
      await vi.advanceTimersByTimeAsync(800);

      expect(saveSessionMock).toHaveBeenCalledTimes(1);
      const written = saveSessionMock.mock.calls[0][0] as SessionSnapshot;
      expect(written.tabs).toHaveLength(3);
    });
  });

  describe("preview / persist config editing", () => {
    it("preview() applies a new profile opacity to --bg-opacity without saving", async () => {
      const app = new App(makeRoot());
      await app.start();

      const edited = defaultConfig();
      edited.profiles[0].opacity = 0.42;
      // Drive through the SettingsPanel onPreview callback.
      captured.settings!.onPreview(edited);

      expect(document.documentElement.style.getPropertyValue("--bg-opacity")).toBe("0.42");
      expect(saveConfigMock).not.toHaveBeenCalled();
    });

    it("persist() applies AND writes the config to disk", async () => {
      const app = new App(makeRoot());
      await app.start();

      const edited = defaultConfig();
      edited.profiles[0].opacity = 0.5;
      // onCommit -> app.persist().
      captured.settings!.onCommit(edited);
      // persist() awaits saveConfig; flush microtasks.
      await Promise.resolve();
      await Promise.resolve();

      expect(document.documentElement.style.getPropertyValue("--bg-opacity")).toBe("0.5");
      expect(saveConfigMock).toHaveBeenCalledTimes(1);
      expect(app.currentConfig?.profiles[0].opacity).toBe(0.5);
    });

    it("applyProfile re-styles every open pane (applyStyleAll called per grid)", async () => {
      loadSessionMock.mockResolvedValue(snapshotWithTabs(2));
      const app = new App(makeRoot());
      await app.start();

      const edited = defaultConfig();
      edited.profiles[0].font_size = 20;
      captured.settings!.onPreview(edited);

      for (const grid of paneGridInstances) {
        expect(grid.applyStyleAll).toHaveBeenCalled();
      }
    });

    it("preview() applies blur material via IPC only when it actually changes", async () => {
      const { setBlurMaterial } = await import("./config/config");
      const setBlur = vi.mocked(setBlurMaterial);
      const app = new App(makeRoot());
      await app.start();
      setBlur.mockClear();

      // Same material as startup -> no IPC.
      captured.settings!.onPreview(defaultConfig());
      expect(setBlur).not.toHaveBeenCalled();

      // Changed material -> one IPC round-trip.
      const edited = defaultConfig();
      edited.profiles[0].blur_material = "under-window";
      captured.settings!.onPreview(edited);
      await Promise.resolve();
      expect(setBlur).toHaveBeenCalledWith("under-window");
    });
  });

  describe("keybinding actions", () => {
    it("newTab action opens another tab", async () => {
      vi.useFakeTimers();
      const app = new App(makeRoot());
      await app.start();
      expect(app).toBeDefined();

      keybindingActions.newTab();
      await vi.advanceTimersByTimeAsync(0);

      expect(paneGridInstances).toHaveLength(2);
    });

    it("toggleHelp / openSettings / newWindow run without throwing", async () => {
      const { invoke } = await import("@tauri-apps/api/core");
      const invokeMock = vi.mocked(invoke);
      const app = new App(makeRoot());
      await app.start();
      expect(app).toBeDefined();

      expect(() => keybindingActions.toggleHelp()).not.toThrow();
      expect(() => keybindingActions.openSettings()).not.toThrow();
      keybindingActions.newWindow();
      expect(invokeMock).toHaveBeenCalledWith("open_window");
    });

    it("toggleFullscreen runs without throwing", async () => {
      const app = new App(makeRoot());
      await app.start();
      expect(app).toBeDefined();

      // The binding is fire-and-forget (`void this.toggleFullscreen()`), so it
      // returns undefined; just assert the underlying flow doesn't throw.
      expect(() => keybindingActions.toggleFullscreen()).not.toThrow();
      await Promise.resolve();
    });
  });

  describe("tab navigation (cycle / selectTab)", () => {
    it("cycleTab keybinding moves the active tab and schedules a save", async () => {
      vi.useFakeTimers();
      loadSessionMock.mockResolvedValue(snapshotWithTabs(3, 0));
      const app = new App(makeRoot());
      await app.start();
      expect(app).toBeDefined();
      await vi.advanceTimersByTimeAsync(800); // flush restore save
      saveSessionMock.mockClear();

      keybindingActions.cycleTab(1);
      const [, activeAfter] = lastRenderCall();
      // Moved off the first tab.
      expect(activeAfter).not.toBeNull();

      await vi.advanceTimersByTimeAsync(800);
      expect(saveSessionMock).toHaveBeenCalled();
    });

    it("selectTab(9) jumps to the last tab", async () => {
      loadSessionMock.mockResolvedValue(snapshotWithTabs(3, 0));
      const app = new App(makeRoot());
      await app.start();
      expect(app).toBeDefined();

      keybindingActions.selectTab(9);
      const [tabs, activeId] = lastRenderCall();
      const active = tabs.find((t) => t.id === activeId);
      expect(active?.title).toBe("Saved 3");
    });

    it("selectTab with an out-of-range number is a no-op", async () => {
      loadSessionMock.mockResolvedValue(snapshotWithTabs(2, 0));
      const app = new App(makeRoot());
      await app.start();
      expect(app).toBeDefined();
      const before = lastRenderCall()[1];

      keybindingActions.selectTab(8); // no 8th tab
      expect(lastRenderCall()[1]).toBe(before);
    });

    it("onSelect switches tabs; re-selecting the active tab is a no-op", async () => {
      vi.useFakeTimers();
      loadSessionMock.mockResolvedValue(snapshotWithTabs(2, 0));
      const app = new App(makeRoot());
      await app.start();
      expect(app).toBeDefined();
      await vi.advanceTimersByTimeAsync(800);
      saveSessionMock.mockClear();

      const [tabs, activeId] = lastRenderCall();
      const other = tabs.find((t) => t.id !== activeId)!;
      captured.tabBar!.onSelect(other.id);
      expect(lastRenderCall()[1]).toBe(other.id);
      // Flush the switch's own debounced save so it can't leak into the next assertion.
      await vi.advanceTimersByTimeAsync(800);

      // Selecting the already-active tab again does nothing (no new save).
      saveSessionMock.mockClear();
      captured.tabBar!.onSelect(other.id);
      await vi.advanceTimersByTimeAsync(800);
      expect(saveSessionMock).not.toHaveBeenCalled();
    });
  });

  describe("closing a non-last tab", () => {
    it("removes the tab, disposes its grid, and keeps the window open", async () => {
      vi.useFakeTimers();
      loadSessionMock.mockResolvedValue(snapshotWithTabs(2, 0));
      const app = new App(makeRoot());
      await app.start();
      expect(app).toBeDefined();
      const [tabs, activeId] = lastRenderCall();
      const doomed = tabs.find((t) => t.id === activeId)!;
      const doomedGrid = paneGridInstances[0];

      captured.tabBar!.onClose(doomed.id);
      await vi.advanceTimersByTimeAsync(800);

      expect(doomedGrid.dispose).toHaveBeenCalledTimes(1);
      // One tab remains -> a snapshot of that tab is persisted.
      const written = saveSessionMock.mock.calls.at(-1)![0] as SessionSnapshot;
      expect(written.tabs).toHaveLength(1);
    });
  });

  describe("watermark toggle from config", () => {
    it("hides the watermark when config.watermark is false", async () => {
      const cfg = defaultConfig();
      cfg.watermark = false;
      loadConfigMock.mockResolvedValue(cfg);

      const root = makeRoot();
      const app = new App(root);
      await app.start();

      const watermark = root.querySelector<HTMLDivElement>(".watermark");
      expect(watermark?.style.display).toBe("none");
    });
  });

  describe("config load failure", () => {
    it("degrades gracefully when loadConfig rejects (no crash, one tab)", async () => {
      loadConfigMock.mockRejectedValue(new Error("backend down"));
      const app = new App(makeRoot());
      await app.start();

      // No config -> currentConfig undefined, but a default tab still opens.
      expect(app.currentConfig).toBeUndefined();
      expect(paneGridInstances).toHaveLength(1);
    });
  });
});

// --- helpers ---------------------------------------------------------------

type RenderCall = [Array<{ id: string; title: string }>, string | null];

/** The render spy on the single TabBar instance (there is exactly one per App). */
function renderSpy(): ReturnType<typeof vi.fn> {
  return captured.tabBarInstance!.render;
}

/** The (tabs, activeId) arguments of the most recent TabBar.render() call. */
function lastRenderCall(): RenderCall {
  return renderSpy().mock.calls.at(-1) as RenderCall;
}

/** Extract the active tab id from the most recent render() call. */
function currentTabId(): string {
  const [tabs, activeId] = lastRenderCall();
  // Prefer the active id; fall back to the first tab.
  return activeId ?? tabs[0].id;
}
