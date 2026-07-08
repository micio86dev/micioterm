import type { FocusDirection, SplitDirection } from "../core/layout";

export interface KeyActions {
  newTab: () => void;
  /** ⌘W: close the active pane (cascades to tab, then window). */
  closePane: () => void;
  cycleTab: (direction: 1 | -1) => void;
  /** ⌘D horizontal (top/bottom), ⌘⇧D vertical (left/right). */
  splitPane: (direction: SplitDirection) => void;
  /** ⌘⌥Arrow: move focus between panes. */
  focusPane: (direction: FocusDirection) => void;
}

const ARROWS: Record<string, FocusDirection> = {
  ArrowUp: "up",
  ArrowDown: "down",
  ArrowLeft: "left",
  ArrowRight: "right",
};

/**
 * Install global terminal shortcuts. Uses `event.code` (physical keys) so the
 * bracket bindings survive non-US layouts, and runs in the capture phase so the
 * shortcut is swallowed before xterm forwards it to the PTY.
 *
 * Returns a disposer that removes the listener.
 */
export function installKeybindings(actions: KeyActions): () => void {
  const handler = (event: KeyboardEvent) => {
    const meta = event.metaKey;
    const shift = event.shiftKey;
    const ctrl = event.ctrlKey;
    const alt = event.altKey;

    // ⌘⌥Arrow: directional pane focus.
    if (meta && alt) {
      const direction = ARROWS[event.code];
      if (direction) {
        return swallow(event, () => actions.focusPane(direction));
      }
    }

    // ⌘D split (top/bottom), ⌘⇧D split (left/right).
    if (meta && !ctrl && !alt && event.code === "KeyD") {
      return swallow(event, () => actions.splitPane(shift ? "vertical" : "horizontal"));
    }

    // ⌘T new tab, ⌘W close pane (no other modifiers).
    if (meta && !shift && !ctrl && !alt) {
      if (event.code === "KeyT") {
        return swallow(event, actions.newTab);
      }
      if (event.code === "KeyW") {
        return swallow(event, actions.closePane);
      }
    }

    // ⌘⇧] next tab, ⌘⇧[ previous tab.
    if (meta && shift) {
      if (event.code === "BracketRight") {
        return swallow(event, () => actions.cycleTab(1));
      }
      if (event.code === "BracketLeft") {
        return swallow(event, () => actions.cycleTab(-1));
      }
    }

    // ⌃Tab next tab, ⌃⇧Tab previous tab.
    if (ctrl && event.code === "Tab") {
      return swallow(event, () => actions.cycleTab(shift ? -1 : 1));
    }
  };

  window.addEventListener("keydown", handler, true);
  return () => window.removeEventListener("keydown", handler, true);
}

function swallow(event: KeyboardEvent, action: () => void): void {
  event.preventDefault();
  event.stopPropagation();
  action();
}
