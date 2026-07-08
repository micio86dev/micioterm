import { describe, expect, it } from "vitest";

import {
  canSplit,
  closePane,
  createLayout,
  cyclePane,
  focusDirection,
  gridPlan,
  MAX_PANES,
  setActivePane,
  splitPane,
  type PaneLayout,
  type SplitDirection,
} from "./layout";

/** Split repeatedly, giving each new pane an incrementing id. */
function withPanes(count: number, direction: SplitDirection = "vertical"): PaneLayout {
  let layout = createLayout("p0");
  for (let i = 1; i < count; i += 1) {
    layout = splitPane(layout, `p${i}`, direction);
  }
  return layout;
}

describe("splitPane", () => {
  it("adds the new pane and focuses it", () => {
    const layout = splitPane(createLayout("a"), "b", "vertical");
    expect(layout.panes).toEqual(["a", "b"]);
    expect(layout.activeId).toBe("b");
  });

  it("records the orientation of the first split", () => {
    expect(splitPane(createLayout("a"), "b", "horizontal").orientation).toBe("horizontal");
    expect(splitPane(createLayout("a"), "b", "vertical").orientation).toBe("vertical");
  });

  it("grows up to the 4-pane cap", () => {
    const layout = withPanes(MAX_PANES);
    expect(layout.panes).toEqual(["p0", "p1", "p2", "p3"]);
    expect(canSplit(layout)).toBe(false);
  });

  it("is a no-op at the cap (the 5th split is rejected)", () => {
    const full = withPanes(MAX_PANES);
    const after = splitPane(full, "p4", "vertical");
    expect(after).toEqual(full);
  });
});

describe("setActivePane", () => {
  it("focuses an existing pane", () => {
    const layout = setActivePane(withPanes(3), "p0");
    expect(layout.activeId).toBe("p0");
  });

  it("ignores an unknown id", () => {
    const before = withPanes(3);
    expect(setActivePane(before, "ghost")).toEqual(before);
  });
});

describe("closePane", () => {
  it("removes an inactive pane and keeps focus", () => {
    const layout = closePane(setActivePane(withPanes(3), "p2"), "p0");
    expect(layout?.panes).toEqual(["p1", "p2"]);
    expect(layout?.activeId).toBe("p2");
  });

  it("focuses the right neighbor when closing the active pane", () => {
    const layout = closePane(setActivePane(withPanes(3), "p1"), "p1");
    expect(layout?.panes).toEqual(["p0", "p2"]);
    expect(layout?.activeId).toBe("p2");
  });

  it("focuses the new last pane when closing the active rightmost pane", () => {
    const layout = closePane(withPanes(3), "p2");
    expect(layout?.panes).toEqual(["p0", "p1"]);
    expect(layout?.activeId).toBe("p1");
  });

  it("returns null when the last pane is closed (close the tab)", () => {
    expect(closePane(createLayout("only"), "only")).toBeNull();
  });

  it("ignores an unknown id", () => {
    const before = withPanes(2);
    expect(closePane(before, "ghost")).toEqual(before);
  });
});

describe("focusDirection", () => {
  it("moves left/right in a vertical 2-pane split (and ignores up/down)", () => {
    const split = splitPane(createLayout("p0"), "p1", "vertical");
    expect(focusDirection(setActivePane(split, "p0"), "right").activeId).toBe("p1");
    expect(focusDirection(split, "left").activeId).toBe("p0");
    expect(focusDirection(setActivePane(split, "p0"), "down").activeId).toBe("p0");
  });

  it("moves up/down in a horizontal 2-pane split (and ignores left/right)", () => {
    const split = splitPane(createLayout("p0"), "p1", "horizontal");
    expect(focusDirection(setActivePane(split, "p0"), "down").activeId).toBe("p1");
    expect(focusDirection(split, "up").activeId).toBe("p0");
    expect(focusDirection(setActivePane(split, "p0"), "right").activeId).toBe("p0");
  });

  it("navigates the 2+1 three-pane layout", () => {
    const layout = withPanes(3); // p0 top-left, p1 bottom-left, p2 right-full
    expect(focusDirection(setActivePane(layout, "p0"), "down").activeId).toBe("p1");
    expect(focusDirection(setActivePane(layout, "p0"), "right").activeId).toBe("p2");
    expect(focusDirection(setActivePane(layout, "p1"), "up").activeId).toBe("p0");
    expect(focusDirection(setActivePane(layout, "p2"), "left").activeId).toBe("p0");
  });

  it("navigates the 2×2 four-pane grid without diagonals", () => {
    const grid = withPanes(4); // p0 TL, p1 TR, p2 BL, p3 BR
    expect(focusDirection(setActivePane(grid, "p0"), "right").activeId).toBe("p1");
    expect(focusDirection(setActivePane(grid, "p0"), "down").activeId).toBe("p2");
    expect(focusDirection(setActivePane(grid, "p3"), "up").activeId).toBe("p1");
    expect(focusDirection(setActivePane(grid, "p3"), "left").activeId).toBe("p2");
  });

  it("is a no-op when there is no neighbor in that direction", () => {
    const single = createLayout("only");
    expect(focusDirection(single, "right").activeId).toBe("only");
  });
});

describe("cyclePane", () => {
  it("moves focus to the next pane and wraps around", () => {
    const three = withPanes(3); // active p2 (last)
    expect(cyclePane(three, 1).activeId).toBe("p0"); // wraps
    expect(cyclePane(setActivePane(three, "p0"), 1).activeId).toBe("p1");
    expect(cyclePane(setActivePane(three, "p0"), -1).activeId).toBe("p2"); // wraps back
  });

  it("is a no-op with a single pane", () => {
    expect(cyclePane(createLayout("only"), 1).activeId).toBe("only");
  });
});

describe("gridPlan", () => {
  const cellFor = (layout: PaneLayout, paneId: string) =>
    gridPlan(layout).cells.find((c) => c.paneId === paneId);

  it("gives one full cell for a single pane", () => {
    const plan = gridPlan(createLayout("p0"));
    expect(plan.columns).toBe("1fr");
    expect(plan.rows).toBe("1fr");
    expect(plan.cells).toHaveLength(1);
  });

  it("splits into two columns for a vertical 2-pane layout", () => {
    const layout = splitPane(createLayout("p0"), "p1", "vertical");
    const plan = gridPlan(layout);
    expect(plan.columns).toBe("1fr 1fr");
    expect(plan.rows).toBe("1fr");
    expect(cellFor(layout, "p1")?.gridColumn).toBe("2");
  });

  it("splits into two rows for a horizontal 2-pane layout", () => {
    const layout = splitPane(createLayout("p0"), "p1", "horizontal");
    const plan = gridPlan(layout);
    expect(plan.columns).toBe("1fr");
    expect(plan.rows).toBe("1fr 1fr");
    expect(cellFor(layout, "p1")?.gridRow).toBe("2");
  });

  it("makes the third pane span both rows in the 2+1 layout", () => {
    const layout = withPanes(3);
    const plan = gridPlan(layout);
    expect(plan.columns).toBe("1fr 1fr");
    expect(plan.rows).toBe("1fr 1fr");
    expect(cellFor(layout, "p2")).toMatchObject({ gridColumn: "2", gridRow: "1 / 3" });
  });

  it("places four panes in a 2×2 grid", () => {
    const layout = withPanes(4);
    const plan = gridPlan(layout);
    expect(plan.columns).toBe("1fr 1fr");
    expect(plan.rows).toBe("1fr 1fr");
    expect(cellFor(layout, "p3")).toMatchObject({ gridColumn: "2", gridRow: "2" });
  });
});
