import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";

import {
  closeTab,
  createTabsState,
  cycleTab,
  openTab,
  renameTab,
  setActiveTab,
  type TabsState,
} from "./core/tabs";
import { HelpOverlay } from "./ui/help-overlay";
import { installKeybindings } from "./ui/keybindings";
import { PaneGrid, type PaneGridRestore } from "./ui/pane-grid";
import { SettingsPanel } from "./ui/settings-panel";
import { TabBar } from "./ui/tab-bar";
import {
  activeProfile,
  loadConfig,
  saveConfig,
  setBlurMaterial,
  type TerminalConfig,
} from "./config/config";
import { themeFromPalette } from "./theme/xterm-theme";
import type { PaneOptions, PaneStyle } from "./terminal/pane";
import { ptyCwd } from "./terminal/pty-bridge";
import { loadSession, saveSession } from "./session/store";
import type { TabSnapshot } from "./core/session";
import logoUrl from "./assets/miciodev-logo.jpg";

/** Instructions to rebuild one tab (title + its pane layout) on launch. */
interface TabRestore extends PaneGridRestore {
  readonly title: string;
}

let tabCounter = 0;

function newTabId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  tabCounter += 1;
  return `tab-${tabCounter}`;
}

/**
 * Top-level controller. Owns the pure {@link TabsState} and, per tab, a
 * {@link PaneGrid} (1–4 panes). Keeps the tab bar and the visible grid in sync.
 * Pane-level state lives inside each PaneGrid; tab-level state stays in tabs.ts.
 */
export class App {
  private state: TabsState = createTabsState();
  private readonly views = new Map<string, PaneGrid>();
  private readonly tabBar: TabBar;
  private readonly host: HTMLDivElement;
  private readonly watermark: HTMLDivElement;
  private readonly help = new HelpOverlay();
  private readonly settings: SettingsPanel;
  private config: TerminalConfig | undefined;
  private lastBlurMaterial: string | undefined;
  private hintTimer: ReturnType<typeof setTimeout> | undefined;
  private snapshotTimer: ReturnType<typeof setTimeout> | undefined;
  /** True while rebuilding the saved session, to suppress mid-restore snapshots. */
  private restoring = false;
  /** Serialize snapshot writes so two never race (stale-wins / torn state). */
  private savingSession = false;
  private saveQueued = false;

  constructor(private readonly root: HTMLElement) {
    this.tabBar = new TabBar({
      onSelect: (id) => this.switchTo(id),
      onClose: (id) => this.closeTabById(id),
      onNew: () => void this.newTab(),
      onSettings: () => this.openSettings(),
      onRename: (id, title) => this.renameTabById(id, title),
    });

    this.settings = new SettingsPanel({
      onPreview: (config) => this.preview(config),
      onCommit: (config) => void this.persist(config),
    });

    this.host = document.createElement("div");
    this.host.className = "pane-host";

    // Very-low-opacity centered logo watermark behind the panes (spec §4,
    // togglable via config, default on).
    this.watermark = document.createElement("div");
    this.watermark.className = "watermark";
    this.watermark.style.backgroundImage = `url(${logoUrl})`;
    this.host.appendChild(this.watermark);

    this.root.append(this.tabBar.element, this.host, this.help.element, this.settings.element);

    installKeybindings({
      newTab: () => void this.newTab(),
      closePane: () => this.activeGrid()?.closeActivePane(),
      cycleTab: (direction) => this.cycle(direction),
      selectTab: (oneBased) => this.selectTab(oneBased),
      splitPane: (direction) => void this.activeGrid()?.splitActive(direction),
      focusPane: (direction) => this.activeGrid()?.focusActive(direction),
      cyclePane: (direction) => this.activeGrid()?.cycleActive(direction),
      toggleFullscreen: () => void this.toggleFullscreen(),
      clearTerminal: () => this.activeGrid()?.clearActive(),
      newWindow: () => void invoke("open_window").catch(() => undefined),
      toggleHelp: () => this.help.toggle(),
      openSettings: () => this.openSettings(),
    });
  }

  /** Open Preferences (⌘, or the gear button) on the current config. */
  private openSettings(): void {
    if (this.config) {
      this.settings.toggle(this.config);
    }
  }

  /** Rename a tab (double-click its label) and persist the change. */
  private renameTabById(id: string, title: string): void {
    this.state = renameTab(this.state, id, title);
    this.render();
    this.scheduleSnapshot();
  }

  /** Jump to a tab by 1-based number; ⌘9 selects the last tab. */
  private selectTab(oneBased: number): void {
    const index = oneBased === 9 ? this.state.tabs.length - 1 : oneBased - 1;
    const tab = this.state.tabs[index];
    if (tab) {
      this.switchTo(tab.id);
    }
  }

  async start(): Promise<void> {
    // Load config (missing/invalid → backend already returned defaults).
    this.config = await loadConfig().catch(() => undefined);
    this.applyGlobalConfig();
    // The native window already carries this material from startup; record it so
    // the first live change is the first IPC we send.
    if (this.config) {
      this.lastBlurMaterial = activeProfile(this.config).blur_material;
    }

    const restored = await this.restoreSession();
    if (!restored) {
      await this.newTab();
    }
  }

  /**
   * Rebuild the last session (main window only). Returns false when there's
   * nothing to restore, so the caller opens a fresh tab instead.
   */
  private async restoreSession(): Promise<boolean> {
    if (getCurrentWindow().label !== "main") {
      return false;
    }
    const snapshot = await loadSession();
    if (!snapshot) {
      return false;
    }
    this.restoring = true;
    let complete = false;
    try {
      for (const tab of snapshot.tabs) {
        await this.newTab({
          title: tab.title,
          panes: tab.panes.map((pane) => ({ cwd: pane.cwd, name: pane.name })),
          orientation: tab.orientation,
          activeIndex: tab.activePaneIndex,
        });
      }
      const activeTab = this.state.tabs[snapshot.activeTabIndex];
      if (activeTab) {
        this.switchTo(activeTab.id);
      }
      complete = true;
    } catch (error) {
      console.warn("[micioterm] session restore failed", error);
    } finally {
      this.restoring = false;
    }
    const restored = this.state.tabs.length > 0;
    // Only re-persist when the WHOLE session restored — a partial restore must
    // not overwrite the good snapshot and permanently drop the rest.
    if (complete && restored) {
      this.scheduleSnapshot();
    }
    return restored;
  }

  /** Apply window-wide config: active-profile opacity and watermark visibility. */
  private applyGlobalConfig(): void {
    if (!this.config) {
      return;
    }
    const profile = activeProfile(this.config);
    document.documentElement.style.setProperty("--bg-opacity", String(profile.opacity));
    this.watermark.style.display = this.config.watermark ? "" : "none";
  }

  /** Live-updatable style (font, size, cursor, colors) from the active profile. */
  private paneStyle(): PaneStyle {
    if (!this.config) {
      return {};
    }
    const profile = activeProfile(this.config);
    return {
      fontFamily: `"${profile.font_family}", "SFMono-Regular", Menlo, ui-monospace, monospace`,
      fontSize: profile.font_size,
      cursorBlink: profile.cursor_blink,
      theme: themeFromPalette(profile.palette),
    };
  }

  /** Per-pane options: live style plus spawn-time settings (scrollback). */
  private paneOptions(): PaneOptions {
    if (!this.config) {
      return {};
    }
    return { scrollback: this.config.scrollback, ...this.paneStyle() };
  }

  /** Re-apply the active profile to every open pane + window chrome, live. */
  private applyProfile(): void {
    if (!this.config) {
      return;
    }
    this.applyGlobalConfig();
    const style = this.paneStyle();
    for (const grid of this.views.values()) {
      grid.applyStyleAll(style);
    }
    // Blur material needs a round-trip to the OS; only re-apply on real change.
    const material = activeProfile(this.config).blur_material;
    if (material !== this.lastBlurMaterial) {
      this.lastBlurMaterial = material;
      void setBlurMaterial(material).catch(() => undefined);
    }
  }

  /** The current config snapshot, for the Preferences UI. */
  get currentConfig(): TerminalConfig | undefined {
    return this.config;
  }

  /** Live-preview a config edit: applied to the running UI, not yet persisted. */
  preview(config: TerminalConfig): void {
    this.config = config;
    this.applyProfile();
  }

  /** Apply and persist a config to disk (Preferences "save"). */
  async persist(config: TerminalConfig): Promise<void> {
    this.preview(config);
    await saveConfig(config).catch(() => undefined);
  }

  private async newTab(restore?: TabRestore): Promise<void> {
    tabCounter += 1;
    const id = newTabId();
    const title = restore?.title ?? `Terminal ${tabCounter}`;
    // TabRestore extends PaneGridRestore, so it carries the pane layout directly.
    const gridRestore: PaneGridRestore | undefined = restore;
    const grid = new PaneGrid(
      {
        onEmpty: () => this.closeTabById(id),
        onSplitRejected: () => this.flashSplitHint(),
        onChange: () => this.scheduleSnapshot(),
      },
      this.paneOptions(),
      gridRestore,
    );

    this.views.set(id, grid);
    this.state = openTab(this.state, { id, title });
    this.host.appendChild(grid.element);
    this.showOnly(id);
    this.render();

    await grid.start();
    grid.focus();
    this.scheduleSnapshot();
  }

  private switchTo(id: string): void {
    if (!this.views.has(id) || this.state.activeId === id) {
      return;
    }
    this.state = setActiveTab(this.state, id);
    this.reveal(id);
    this.scheduleSnapshot();
  }

  private cycle(direction: 1 | -1): void {
    const previous = this.state.activeId;
    this.state = cycleTab(this.state, direction);
    if (this.state.activeId && this.state.activeId !== previous) {
      this.reveal(this.state.activeId);
      this.scheduleSnapshot();
    }
  }

  private closeTabById(id: string): void {
    const grid = this.views.get(id);
    this.state = closeTab(this.state, id);
    this.views.delete(id);
    void grid?.dispose();

    if (this.state.tabs.length === 0) {
      // Closing the last tab closes the window (standard macOS behavior).
      void getCurrentWindow().close();
      return;
    }
    this.reveal(this.state.activeId);
    this.scheduleSnapshot();
  }

  private activeGrid(): PaneGrid | undefined {
    return this.state.activeId ? this.views.get(this.state.activeId) : undefined;
  }

  private async toggleFullscreen(): Promise<void> {
    const win = getCurrentWindow();
    await win.setFullscreen(!(await win.isFullscreen()));
  }

  /** Show only the active tab's grid, refit it, focus it, repaint the tab bar. */
  private reveal(activeId: string | null): void {
    this.showOnly(activeId);
    this.render();
    if (activeId) {
      const grid = this.views.get(activeId);
      grid?.refitAll();
      grid?.focus();
    }
  }

  private showOnly(activeId: string | null): void {
    for (const [id, grid] of this.views) {
      grid.element.classList.toggle("view--hidden", id !== activeId);
    }
  }

  private render(): void {
    this.tabBar.render(this.state.tabs, this.state.activeId);
  }

  /** Debounced session persist (main window only), coalescing bursts of edits. */
  private scheduleSnapshot(): void {
    if (this.restoring || getCurrentWindow().label !== "main") {
      return;
    }
    clearTimeout(this.snapshotTimer);
    this.snapshotTimer = setTimeout(() => void this.persistSession(), 800);
  }

  /**
   * Capture tabs + per-pane cwd/name and write the snapshot to disk. Serialized:
   * if a save is already running, coalesce into a single follow-up so two writes
   * never race (which could let a stale snapshot win).
   */
  private async persistSession(): Promise<void> {
    if (this.savingSession) {
      this.saveQueued = true;
      return;
    }
    this.savingSession = true;
    try {
      const tabs: TabSnapshot[] = [];
      for (const tab of this.state.tabs) {
        const grid = this.views.get(tab.id);
        if (!grid) {
          continue;
        }
        const snap = grid.snapshot();
        const cwds = await Promise.all(
          snap.panes.map((pane) => ptyCwd(pane.sessionId).catch(() => null)),
        );
        tabs.push({
          title: tab.title,
          orientation: snap.orientation,
          activePaneIndex: snap.activeIndex,
          panes: snap.panes.map((pane, i) => ({ cwd: cwds[i], name: pane.name || null })),
        });
      }
      // Never overwrite a good snapshot with an empty one (e.g. mid-teardown).
      if (tabs.length === 0) {
        return;
      }
      const activeTabIndex = Math.max(
        0,
        this.state.tabs.findIndex((tab) => tab.id === this.state.activeId),
      );
      saveSession({ version: 1, activeTabIndex, tabs });
    } finally {
      this.savingSession = false;
      // A save was requested while this one ran — run once more with fresh state.
      if (this.saveQueued) {
        this.saveQueued = false;
        void this.persistSession();
      }
    }
  }

  /** Subtle transient hint when a 5th split is rejected. */
  private flashSplitHint(): void {
    let hint = this.host.querySelector<HTMLDivElement>(".split-hint");
    if (!hint) {
      hint = document.createElement("div");
      hint.className = "split-hint";
      hint.textContent = "Max 4 panes per tab";
      this.host.appendChild(hint);
    }
    hint.classList.add("split-hint--visible");
    clearTimeout(this.hintTimer);
    this.hintTimer = setTimeout(() => hint?.classList.remove("split-hint--visible"), 1200);
  }
}
