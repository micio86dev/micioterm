import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";

import {
  closeTab,
  createTabsState,
  cycleTab,
  openTab,
  setActiveTab,
  type TabsState,
} from "./core/tabs";
import { HelpOverlay } from "./ui/help-overlay";
import { installKeybindings } from "./ui/keybindings";
import { PaneGrid } from "./ui/pane-grid";
import { TabBar } from "./ui/tab-bar";
import { loadConfig, type TerminalConfig } from "./config/config";
import { themeFromPalette } from "./theme/xterm-theme";
import type { PaneOptions } from "./terminal/pane";
import logoUrl from "./assets/miciodev-logo.jpg";

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
  private config: TerminalConfig | undefined;
  private hintTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly root: HTMLElement) {
    this.tabBar = new TabBar({
      onSelect: (id) => this.switchTo(id),
      onClose: (id) => this.closeTabById(id),
      onNew: () => void this.newTab(),
    });

    this.host = document.createElement("div");
    this.host.className = "pane-host";

    // Very-low-opacity centered logo watermark behind the panes (spec §4,
    // togglable via config, default on).
    this.watermark = document.createElement("div");
    this.watermark.className = "watermark";
    this.watermark.style.backgroundImage = `url(${logoUrl})`;
    this.host.appendChild(this.watermark);

    this.root.append(this.tabBar.element, this.host, this.help.element);

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
    });
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
    await this.newTab();
  }

  /** Apply window-wide config: background opacity and watermark visibility. */
  private applyGlobalConfig(): void {
    if (!this.config) {
      return;
    }
    document.documentElement.style.setProperty("--bg-opacity", String(this.config.opacity));
    this.watermark.style.display = this.config.watermark ? "" : "none";
  }

  /** Per-pane options derived from config (font, palette, cursor, scrollback). */
  private paneOptions(): PaneOptions {
    if (!this.config) {
      return {};
    }
    return {
      scrollback: this.config.scrollback,
      fontFamily: `"${this.config.font_family}", "SFMono-Regular", Menlo, ui-monospace, monospace`,
      fontSize: this.config.font_size,
      cursorBlink: this.config.cursor_blink,
      theme: themeFromPalette(this.config.palette),
    };
  }

  private async newTab(): Promise<void> {
    tabCounter += 1;
    const id = newTabId();
    const title = `Terminal ${tabCounter}`;
    const grid = new PaneGrid(
      {
        onEmpty: () => this.closeTabById(id),
        onSplitRejected: () => this.flashSplitHint(),
      },
      this.paneOptions(),
    );

    this.views.set(id, grid);
    this.state = openTab(this.state, { id, title });
    this.host.appendChild(grid.element);
    this.showOnly(id);
    this.render();

    await grid.start();
    grid.focus();
  }

  private switchTo(id: string): void {
    if (!this.views.has(id) || this.state.activeId === id) {
      return;
    }
    this.state = setActiveTab(this.state, id);
    this.reveal(id);
  }

  private cycle(direction: 1 | -1): void {
    const previous = this.state.activeId;
    this.state = cycleTab(this.state, direction);
    if (this.state.activeId && this.state.activeId !== previous) {
      this.reveal(this.state.activeId);
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
