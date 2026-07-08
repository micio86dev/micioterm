/**
 * Pure pane-layout state machine for one tab. Models an ordered list of panes
 * (1–4), which one is focused, and — for the 2-pane case — the split
 * orientation. Beyond two panes the arrangement is fixed by the spec (2+1, 2×2),
 * so pane count alone determines the grid.
 *
 * Knows nothing about xterm or the DOM. Every function returns a new value.
 * Pane ids are supplied by the caller for deterministic tests.
 */

export type SplitDirection = "horizontal" | "vertical";
export type FocusDirection = "up" | "down" | "left" | "right";

/** Hard cap: at most 4 panes per tab (spec §Panes). */
export const MAX_PANES = 4;

export interface PaneLayout {
  readonly panes: readonly string[];
  readonly activeId: string;
  /** Only meaningful when `panes.length === 2`. */
  readonly orientation: SplitDirection;
}

export function createLayout(firstPaneId: string): PaneLayout {
  return { panes: [firstPaneId], activeId: firstPaneId, orientation: "vertical" };
}

/** True while another split is allowed (below the 4-pane cap). */
export function canSplit(layout: PaneLayout): boolean {
  return layout.panes.length < MAX_PANES;
}

/** Add a pane (up to the cap) and focus it. At the cap this is a no-op. */
export function splitPane(
  layout: PaneLayout,
  newPaneId: string,
  direction: SplitDirection,
): PaneLayout {
  if (!canSplit(layout)) {
    return layout;
  }
  const panes = [...layout.panes, newPaneId];
  // Orientation only shapes the 2-pane layout; 2+1 and 2×2 are fixed by count.
  const orientation = panes.length === 2 ? direction : layout.orientation;
  return { panes, activeId: newPaneId, orientation };
}

/** Focus an existing pane. Unknown ids are ignored. */
export function setActivePane(layout: PaneLayout, id: string): PaneLayout {
  if (!layout.panes.includes(id)) {
    return layout;
  }
  return { ...layout, activeId: id };
}

/**
 * Remove a pane and reflow. Returns the new layout, or `null` when the last pane
 * was closed — the caller then closes the tab.
 */
export function closePane(layout: PaneLayout, id: string): PaneLayout | null {
  const index = layout.panes.indexOf(id);
  if (index === -1) {
    return layout;
  }

  const panes = layout.panes.filter((paneId) => paneId !== id);
  if (panes.length === 0) {
    return null;
  }
  if (layout.activeId !== id) {
    return { ...layout, panes };
  }

  const nextActive = panes[index] ?? panes[panes.length - 1];
  return { ...layout, panes, activeId: nextActive };
}

/** A pane's placement in the CSS grid (line-based `grid-column` / `grid-row`). */
export interface GridCell {
  readonly paneId: string;
  readonly gridColumn: string;
  readonly gridRow: string;
}

/** The full grid arrangement for a layout, ready for the UI to apply. */
export interface GridPlan {
  readonly columns: string;
  readonly rows: string;
  readonly cells: readonly GridCell[];
}

/**
 * Map a layout to its CSS-grid arrangement. These are the four fixed layouts
 * from the spec: 1 (full), 2 (split by orientation), 3 (2+1), 4 (2×2).
 */
export function gridPlan(layout: PaneLayout): GridPlan {
  const [p0, p1, p2, p3] = layout.panes;
  switch (layout.panes.length) {
    case 1:
      return { columns: "1fr", rows: "1fr", cells: [cell(p0, "1", "1")] };
    case 2:
      return layout.orientation === "vertical"
        ? {
            columns: "1fr 1fr",
            rows: "1fr",
            cells: [cell(p0, "1", "1"), cell(p1, "2", "1")],
          }
        : {
            columns: "1fr",
            rows: "1fr 1fr",
            cells: [cell(p0, "1", "1"), cell(p1, "1", "2")],
          };
    case 3:
      // Left column stacked (p0/p1), tall pane p2 spanning both rows on the right.
      return {
        columns: "1fr 1fr",
        rows: "1fr 1fr",
        cells: [cell(p0, "1", "1"), cell(p1, "1", "2"), cell(p2, "2", "1 / 3")],
      };
    default:
      return {
        columns: "1fr 1fr",
        rows: "1fr 1fr",
        cells: [
          cell(p0, "1", "1"),
          cell(p1, "2", "1"),
          cell(p2, "1", "2"),
          cell(p3, "2", "2"),
        ],
      };
  }
}

function cell(paneId: string, gridColumn: string, gridRow: string): GridCell {
  return { paneId, gridColumn, gridRow };
}

type Neighbors = Partial<Record<FocusDirection, number>>;

/**
 * Spatial neighbor map for each fixed layout, by pane index. Indices follow the
 * grid placement in {@link gridPlan}:
 *   2 vertical  → [left, right]        2 horizontal → [top, bottom]
 *   3 (2+1)     → [top-left, bottom-left, right-full]
 *   4 (2×2)     → [top-left, top-right, bottom-left, bottom-right]
 */
function neighborsFor(count: number, orientation: SplitDirection): Neighbors[] {
  switch (count) {
    case 2:
      return orientation === "vertical"
        ? [{ right: 1 }, { left: 0 }]
        : [{ down: 1 }, { up: 0 }];
    case 3:
      return [{ down: 1, right: 2 }, { up: 0, right: 2 }, { left: 0 }];
    case 4:
      return [
        { right: 1, down: 2 },
        { left: 0, down: 3 },
        { up: 0, right: 3 },
        { up: 1, left: 2 },
      ];
    default:
      return [{}];
  }
}

/** Cycle focus to the next (+1) or previous (-1) pane, wrapping around. */
export function cyclePane(layout: PaneLayout, direction: 1 | -1): PaneLayout {
  if (layout.panes.length <= 1) {
    return layout;
  }
  const current = layout.panes.indexOf(layout.activeId);
  const count = layout.panes.length;
  const next = (current + direction + count) % count;
  return { ...layout, activeId: layout.panes[next] };
}

/** Move focus to the neighboring pane in `direction`, if one exists. */
export function focusDirection(layout: PaneLayout, direction: FocusDirection): PaneLayout {
  const index = layout.panes.indexOf(layout.activeId);
  const neighbors = neighborsFor(layout.panes.length, layout.orientation)[index];
  const targetIndex = neighbors?.[direction];
  if (targetIndex === undefined) {
    return layout;
  }
  return { ...layout, activeId: layout.panes[targetIndex] };
}
