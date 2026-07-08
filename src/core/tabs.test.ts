import { describe, expect, it } from "vitest";

import { closeTab, createTabsState, cycleTab, openTab, setActiveTab } from "./tabs";

const tab = (id: string) => ({ id, title: id });

/** Open the given ids in order; the last one ends up active. */
const withTabs = (...ids: string[]) =>
  ids.reduce((state, id) => openTab(state, tab(id)), createTabsState());

describe("openTab", () => {
  it("appends the tab and makes it active", () => {
    const state = openTab(createTabsState(), tab("a"));
    expect(state.tabs.map((t) => t.id)).toEqual(["a"]);
    expect(state.activeId).toBe("a");
  });

  it("keeps insertion order and activates the newest", () => {
    const state = withTabs("a", "b", "c");
    expect(state.tabs.map((t) => t.id)).toEqual(["a", "b", "c"]);
    expect(state.activeId).toBe("c");
  });
});

describe("setActiveTab", () => {
  it("activates an existing tab", () => {
    const state = setActiveTab(withTabs("a", "b", "c"), "a");
    expect(state.activeId).toBe("a");
  });

  it("ignores an unknown id", () => {
    const before = withTabs("a", "b");
    const after = setActiveTab(before, "ghost");
    expect(after.activeId).toBe("b");
  });
});

describe("closeTab", () => {
  it("removes an inactive tab and keeps the active one", () => {
    const state = closeTab(setActiveTab(withTabs("a", "b", "c"), "c"), "a");
    expect(state.tabs.map((t) => t.id)).toEqual(["b", "c"]);
    expect(state.activeId).toBe("c");
  });

  it("activates the right neighbor when closing the active tab", () => {
    const state = closeTab(setActiveTab(withTabs("a", "b", "c"), "b"), "b");
    expect(state.tabs.map((t) => t.id)).toEqual(["a", "c"]);
    expect(state.activeId).toBe("c");
  });

  it("activates the new last tab when closing the active rightmost tab", () => {
    const state = closeTab(withTabs("a", "b", "c"), "c");
    expect(state.tabs.map((t) => t.id)).toEqual(["a", "b"]);
    expect(state.activeId).toBe("b");
  });

  it("empties the state when the last tab is closed", () => {
    const state = closeTab(withTabs("a"), "a");
    expect(state.tabs).toEqual([]);
    expect(state.activeId).toBeNull();
  });

  it("ignores an unknown id", () => {
    const before = withTabs("a", "b");
    const after = closeTab(before, "ghost");
    expect(after).toEqual(before);
  });
});

describe("cycleTab", () => {
  it("moves to the next tab", () => {
    const state = cycleTab(setActiveTab(withTabs("a", "b", "c"), "a"), 1);
    expect(state.activeId).toBe("b");
  });

  it("wraps from the last tab to the first", () => {
    const state = cycleTab(withTabs("a", "b", "c"), 1);
    expect(state.activeId).toBe("a");
  });

  it("wraps from the first tab to the last going backwards", () => {
    const state = cycleTab(setActiveTab(withTabs("a", "b", "c"), "a"), -1);
    expect(state.activeId).toBe("c");
  });

  it("is a no-op with a single tab", () => {
    const state = cycleTab(withTabs("a"), 1);
    expect(state.activeId).toBe("a");
  });

  it("is a no-op with no tabs", () => {
    const state = cycleTab(createTabsState(), 1);
    expect(state.activeId).toBeNull();
  });
});
