/**
 * Pure tab state machine. Holds tab identity and which tab is active; knows
 * nothing about panes, xterm, or the DOM. Every function returns a new state —
 * callers never mutate. Tab ids are supplied by the caller so this stays
 * deterministic and testable.
 */

export interface Tab {
  readonly id: string;
  readonly title: string;
}

export interface TabsState {
  readonly tabs: readonly Tab[];
  readonly activeId: string | null;
}

export function createTabsState(): TabsState {
  return { tabs: [], activeId: null };
}

/** Append a tab and make it active. */
export function openTab(state: TabsState, tab: Tab): TabsState {
  return { tabs: [...state.tabs, tab], activeId: tab.id };
}

/** Make an existing tab active. Unknown ids are ignored. */
export function setActiveTab(state: TabsState, id: string): TabsState {
  if (!state.tabs.some((t) => t.id === id)) {
    return state;
  }
  return { ...state, activeId: id };
}

/**
 * Remove a tab. If the closed tab was active, activate its right neighbor, or
 * the new last tab if it was rightmost. Closing the final tab yields an empty
 * state (activeId null) — the UI treats that as "close the window".
 */
export function closeTab(state: TabsState, id: string): TabsState {
  const index = state.tabs.findIndex((t) => t.id === id);
  if (index === -1) {
    return state;
  }

  const tabs = state.tabs.filter((t) => t.id !== id);
  if (state.activeId !== id) {
    return { ...state, tabs };
  }
  if (tabs.length === 0) {
    return { tabs: [], activeId: null };
  }

  const nextActive = tabs[index] ?? tabs[tabs.length - 1];
  return { tabs, activeId: nextActive.id };
}

/** Move the active tab by `direction` (+1 next, -1 previous), wrapping around. */
export function cycleTab(state: TabsState, direction: 1 | -1): TabsState {
  if (state.tabs.length === 0 || state.activeId === null) {
    return state;
  }
  const current = state.tabs.findIndex((t) => t.id === state.activeId);
  const count = state.tabs.length;
  const next = (current + direction + count) % count;
  return { ...state, activeId: state.tabs[next].id };
}
