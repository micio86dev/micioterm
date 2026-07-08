import {
  canSplit,
  closePane,
  createLayout,
  focusDirection,
  gridPlan,
  setActivePane,
  splitPane,
  type FocusDirection,
  type PaneLayout,
  type SplitDirection,
} from "../core/layout";
import { Pane, type PaneOptions } from "../terminal/pane";

export interface PaneGridCallbacks {
  /** The last pane was closed — the owner should close the tab. */
  onEmpty: () => void;
  /** A split was rejected at the 4-pane cap — show a subtle hint. */
  onSplitRejected?: () => void;
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
    private readonly paneOptions: PaneOptions = {},
  ) {
    this.element = document.createElement("div");
    this.element.className = "pane-grid";

    const first = new Pane(this.paneOptions);
    this.panes.set(first.sessionId, first);
    this.layout = createLayout(first.sessionId);
  }

  /** Mount the first pane and lay out the grid. */
  async start(): Promise<void> {
    const first = this.panes.get(this.layout.activeId);
    if (!first) {
      return;
    }
    this.applyGrid();
    await first.mount(this.element);
    this.wirePane(first);
    first.focus();
  }

  /** Split the active pane, up to the 4-pane cap. */
  async splitActive(direction: SplitDirection): Promise<void> {
    if (!canSplit(this.layout)) {
      this.callbacks.onSplitRejected?.();
      return;
    }
    const pane = new Pane(this.paneOptions);
    this.panes.set(pane.sessionId, pane);
    this.layout = splitPane(this.layout, pane.sessionId, direction);

    this.applyGrid();
    await pane.mount(this.element);
    this.wirePane(pane);
    this.refitAll();
    pane.focus();
  }

  /** Close the active pane; reflow, or signal the tab to close if it was last. */
  closeActivePane(): void {
    const id = this.layout.activeId;
    const pane = this.panes.get(id);
    const next = closePane(this.layout, id);
    this.panes.delete(id);
    void pane?.dispose();

    if (next === null) {
      this.callbacks.onEmpty();
      return;
    }
    this.layout = next;
    this.applyGrid();
    this.refitAll();
    this.panes.get(this.layout.activeId)?.focus();
  }

  /** Move focus to the neighboring pane (⌘⌥Arrow). */
  focusActive(direction: FocusDirection): void {
    const before = this.layout.activeId;
    this.layout = focusDirection(this.layout, direction);
    if (this.layout.activeId !== before) {
      this.applyGrid();
      this.panes.get(this.layout.activeId)?.focus();
    }
  }

  refitAll(): void {
    for (const pane of this.panes.values()) {
      pane.refit();
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
  }

  /** Focus follows click. Capture phase, no preventDefault so selection works. */
  private wirePane(pane: Pane): void {
    pane.element.addEventListener("mousedown", () => this.selectPane(pane.sessionId), true);
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
