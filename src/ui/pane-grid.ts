import {
  canSplit,
  closePane,
  createLayout,
  cyclePane,
  focusDirection,
  gridPlan,
  setActivePane,
  splitPane,
  type FocusDirection,
  type PaneLayout,
  type SplitDirection,
} from "../core/layout";
import { Pane, type PaneOptions, type PaneStyle } from "../terminal/pane";
import { ptyCwd } from "../terminal/pty-bridge";

export interface PaneGridCallbacks {
  /** The last pane was closed — the owner should close the tab. */
  onEmpty: () => void;
  /** A split was rejected at the 4-pane cap — show a subtle hint. */
  onSplitRejected?: () => void;
  /** The layout changed (split/close/focus) — the owner may snapshot it. */
  onChange?: () => void;
}

/** One pane's live identity, captured for session restore. */
export interface PaneGridSnapshotPane {
  readonly sessionId: string;
  readonly name: string;
}

/** A tab's layout, captured for session restore. */
export interface PaneGridSnapshot {
  readonly orientation: SplitDirection;
  readonly activeIndex: number;
  /** Ordered panes (session id feeds the cwd lookup; name is the label). */
  readonly panes: readonly PaneGridSnapshotPane[];
}

/** One pane to rebuild on launch: where to open it and what to call it. */
export interface PaneRestore {
  readonly cwd: string | null;
  readonly name: string | null;
}

/** Instructions to rebuild a tab's panes on launch. */
export interface PaneGridRestore {
  readonly panes: readonly PaneRestore[];
  readonly orientation: SplitDirection;
  readonly activeIndex: number;
}

/**
 * Renders one tab's panes into a CSS grid driven by the pure {@link PaneLayout}.
 * Owns the live {@link Pane} instances; the pure state machine owns arrangement,
 * focus, and the split cap. All panes are visible at once — the grid places them.
 */
export class PaneGrid {
  readonly element: HTMLDivElement;

  private layout: PaneLayout;
  private readonly panes = new Map<string, Pane>();

  constructor(
    private readonly callbacks: PaneGridCallbacks,
    private paneOptions: PaneOptions = {},
    private readonly restoreSpec?: PaneGridRestore,
  ) {
    this.element = document.createElement("div");
    this.element.className = "pane-grid";

    const firstSpec = restoreSpec?.panes[0];
    const first = new Pane({
      ...this.paneOptions,
      cwd: firstSpec?.cwd ?? undefined,
      name: firstSpec?.name ?? undefined,
    });
    this.panes.set(first.sessionId, first);
    this.layout = createLayout(first.sessionId);
  }

  /** Mount the first pane, rebuild any restored panes, and lay out the grid. */
  async start(): Promise<void> {
    const first = this.panes.get(this.layout.activeId);
    if (!first) {
      return;
    }
    this.applyGrid();
    this.wirePane(first);
    await first.mount(this.element);

    if (this.restoreSpec && this.restoreSpec.panes.length > 1) {
      for (let i = 1; i < this.restoreSpec.panes.length; i += 1) {
        await this.addRestoredPane(this.restoreSpec.panes[i]);
      }
      const activeId = this.layout.panes[this.restoreSpec.activeIndex];
      if (activeId) {
        this.layout = setActivePane(this.layout, activeId);
        this.applyGrid();
      }
      this.refitAll();
    }

    this.panes.get(this.layout.activeId)?.focus();
  }

  /** Recreate one restored pane in its saved cwd/name (used only during restore). */
  private async addRestoredPane(spec: PaneRestore): Promise<void> {
    if (!canSplit(this.layout)) {
      return;
    }
    const pane = new Pane({
      ...this.paneOptions,
      cwd: spec.cwd ?? undefined,
      name: spec.name ?? undefined,
    });
    this.panes.set(pane.sessionId, pane);
    // Orientation only shapes the 2-pane case; 2+1 and 2×2 are fixed by count.
    this.layout = splitPane(this.layout, pane.sessionId, this.restoreSpec!.orientation);
    this.applyGrid();
    this.wirePane(pane);
    await pane.mount(this.element);
  }

  /** Capture this tab's layout for session restore. */
  snapshot(): PaneGridSnapshot {
    return {
      orientation: this.layout.orientation,
      activeIndex: Math.max(0, this.layout.panes.indexOf(this.layout.activeId)),
      panes: this.layout.panes.map((id) => ({
        sessionId: id,
        name: this.panes.get(id)?.name ?? "",
      })),
    };
  }

  /** Split the active pane, up to the 4-pane cap. */
  async splitActive(direction: SplitDirection): Promise<void> {
    if (!canSplit(this.layout)) {
      this.callbacks.onSplitRejected?.();
      return;
    }
    // Open the new pane in the same directory as the one being split from.
    const active = this.panes.get(this.layout.activeId);
    const cwd = active ? await ptyCwd(active.sessionId).catch(() => null) : null;
    // Re-check the cap: a concurrent split may have filled it during the await,
    // otherwise we'd construct an orphaned pane (a leaked PTY) below.
    if (!canSplit(this.layout)) {
      this.callbacks.onSplitRejected?.();
      return;
    }
    const pane = new Pane({ ...this.paneOptions, cwd: cwd ?? undefined });
    this.panes.set(pane.sessionId, pane);
    this.layout = splitPane(this.layout, pane.sessionId, direction);

    this.applyGrid();
    this.wirePane(pane);
    await pane.mount(this.element);
    this.refitAll();
    pane.focus();
    this.callbacks.onChange?.();
  }

  /** Close the active pane (⌘W); reflow, or close the tab if it was last. */
  closeActivePane(): void {
    this.closePaneById(this.layout.activeId);
  }

  /** Clear the active pane's terminal (⌘K). */
  clearActive(): void {
    this.panes.get(this.layout.activeId)?.clear();
  }

  /** Close a specific pane (⌘W on it, or its shell exited via Ctrl+D). */
  private closePaneById(id: string): void {
    const pane = this.panes.get(id);
    if (!pane) {
      return; // already gone
    }
    const next = closePane(this.layout, id);
    this.panes.delete(id);
    void pane.dispose();

    if (next === null) {
      this.callbacks.onEmpty();
      return;
    }
    this.layout = next;
    this.applyGrid();
    this.refitAll();
    this.panes.get(this.layout.activeId)?.focus();
    this.callbacks.onChange?.();
  }

  /** Move focus to the neighboring pane (⌘⌥Arrow). */
  focusActive(direction: FocusDirection): void {
    const before = this.layout.activeId;
    this.layout = focusDirection(this.layout, direction);
    if (this.layout.activeId !== before) {
      this.applyGrid();
      this.panes.get(this.layout.activeId)?.focus();
      this.callbacks.onChange?.();
    }
  }

  /** Cycle focus to the next (+1) / previous (-1) pane (⌘] / ⌘[). */
  cycleActive(direction: 1 | -1): void {
    const before = this.layout.activeId;
    this.layout = cyclePane(this.layout, direction);
    if (this.layout.activeId !== before) {
      this.applyGrid();
      this.panes.get(this.layout.activeId)?.focus();
      this.callbacks.onChange?.();
    }
  }

  refitAll(): void {
    for (const pane of this.panes.values()) {
      pane.refit();
    }
  }

  /**
   * Apply a live style to every pane in this tab, and remember it so panes
   * created later (splits) inherit the same look.
   */
  applyStyleAll(style: PaneStyle): void {
    this.paneOptions = { ...this.paneOptions, ...style };
    for (const pane of this.panes.values()) {
      pane.applyStyle(style);
    }
  }

  focus(): void {
    this.panes.get(this.layout.activeId)?.focus();
  }

  async dispose(): Promise<void> {
    for (const pane of this.panes.values()) {
      await pane.dispose();
    }
    this.element.remove();
  }

  private selectPane(id: string): void {
    if (this.layout.activeId === id) {
      return;
    }
    this.layout = setActivePane(this.layout, id);
    this.applyGrid();
    this.panes.get(id)?.focus();
    this.callbacks.onChange?.();
  }

  /** Focus follows click; the shell exiting (Ctrl+D) closes the pane. */
  private wirePane(pane: Pane): void {
    pane.element.addEventListener("mousedown", () => this.selectPane(pane.sessionId), true);
    pane.onExit = () => this.closePaneById(pane.sessionId);
    pane.onRename = () => this.callbacks.onChange?.();
  }

  private applyGrid(): void {
    const plan = gridPlan(this.layout);
    this.element.style.gridTemplateColumns = plan.columns;
    this.element.style.gridTemplateRows = plan.rows;
    for (const cell of plan.cells) {
      const pane = this.panes.get(cell.paneId);
      if (!pane) {
        continue;
      }
      pane.element.style.gridColumn = cell.gridColumn;
      pane.element.style.gridRow = cell.gridRow;
      pane.element.classList.toggle("pane--active", cell.paneId === this.layout.activeId);
    }
  }
}
