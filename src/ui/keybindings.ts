import type { FocusDirection, SplitDirection } from "../core/layout";

export interface KeyActions {
  newTab: () => void;
  /** ⌘W: close the active pane (cascades to tab, then window). */
  closePane: () => void;
  cycleTab: (direction: 1 | -1) => void;
  /** ⌘1–⌘9: jump to tab N (⌘9 = last). */
  selectTab: (oneBased: number) => void;
  /** ⌘D vertical (left/right), ⌘⇧D horizontal (top/bottom). */
  splitPane: (direction: SplitDirection) => void;
  /** ⌘⌥Arrow: move focus between panes directionally. */
  focusPane: (direction: FocusDirection) => void;
  /** ⌘] / ⌘[: cycle focus to the next / previous pane. */
  cyclePane: (direction: 1 | -1) => void;
  /** ⌘/ : toggle the keyboard-shortcuts help overlay. */
  toggleHelp: () => void;
  /** ⌘, : open the Preferences panel. */
  openSettings: () => void;
  /** ⌘F or ⌘Enter: toggle native fullscreen. */
  toggleFullscreen: () => void;
  /** ⌘K: clear the active terminal. */
  clearTerminal: () => void;
  /** ⌘N: open a new window. */
  newWindow: () => void;
}

const ARROWS: Record<string, FocusDirection> = {
  ArrowUp: "up",
  ArrowDown: "down",
  ArrowLeft: "left",
  ArrowRight: "right",
};

const DIGITS: Record<string, number> = {
  Digit1: 1,
  Digit2: 2,
  Digit3: 3,
  Digit4: 4,
  Digit5: 5,
  Digit6: 6,
  Digit7: 7,
  Digit8: 8,
  Digit9: 9,
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

    // ⌘F or ⌘Enter: toggle native fullscreen.
    if (
      meta &&
      !ctrl &&
      !alt &&
      (event.code === "KeyF" || event.code === "Enter" || event.code === "NumpadEnter")
    ) {
      return swallow(event, actions.toggleFullscreen);
    }

    // ⌘⌥Arrow: directional pane focus.
    if (meta && alt) {
      const direction = ARROWS[event.code];
      if (direction) {
        return swallow(event, () => actions.focusPane(direction));
      }
    }

    // ⌘D split left/right, ⌘⇧D split top/bottom.
    if (meta && !ctrl && !alt && event.code === "KeyD") {
      return swallow(event, () => actions.splitPane(shift ? "horizontal" : "vertical"));
    }

    // ⌘T new tab, ⌘W close pane, ⌘K clear terminal (no other modifiers).
    if (meta && !shift && !ctrl && !alt) {
      if (event.code === "KeyT") {
        return swallow(event, actions.newTab);
      }
      if (event.code === "KeyW") {
        return swallow(event, actions.closePane);
      }
      if (event.code === "KeyK") {
        return swallow(event, actions.clearTerminal);
      }
      if (event.code === "KeyN") {
        return swallow(event, actions.newWindow);
      }
      if (event.code === "Slash") {
        return swallow(event, actions.toggleHelp);
      }
      if (event.code === "Comma") {
        return swallow(event, actions.openSettings);
      }
      if (event.code === "BracketRight") {
        return swallow(event, () => actions.cyclePane(1));
      }
      if (event.code === "BracketLeft") {
        return swallow(event, () => actions.cyclePane(-1));
      }
      const digit = DIGITS[event.code];
      if (digit) {
        return swallow(event, () => actions.selectTab(digit));
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
