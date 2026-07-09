import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { installKeybindings, type KeyActions } from "./keybindings";

function makeActions() {
  return {
    newTab: vi.fn(),
    closePane: vi.fn(),
    cycleTab: vi.fn(),
    selectTab: vi.fn(),
    splitPane: vi.fn(),
    focusPane: vi.fn(),
    cyclePane: vi.fn(),
    toggleHelp: vi.fn(),
    openSettings: vi.fn(),
    toggleFullscreen: vi.fn(),
    clearTerminal: vi.fn(),
    newWindow: vi.fn(),
  } satisfies KeyActions;
}

describe("installKeybindings", () => {
  let actions: ReturnType<typeof makeActions>;
  let dispose: () => void;

  beforeEach(() => {
    actions = makeActions();
    dispose = installKeybindings(actions);
  });

  afterEach(() => dispose());

  const press = (code: string, mods: Partial<KeyboardEvent> = {}) =>
    window.dispatchEvent(new KeyboardEvent("keydown", { code, ...mods } as KeyboardEventInit));

  it("maps the plain Cmd shortcuts", () => {
    press("KeyT", { metaKey: true });
    press("KeyW", { metaKey: true });
    press("KeyK", { metaKey: true });
    press("KeyN", { metaKey: true });
    press("Slash", { metaKey: true });
    press("Comma", { metaKey: true });
    expect(actions.newTab).toHaveBeenCalledOnce();
    expect(actions.closePane).toHaveBeenCalledOnce();
    expect(actions.clearTerminal).toHaveBeenCalledOnce();
    expect(actions.newWindow).toHaveBeenCalledOnce();
    expect(actions.toggleHelp).toHaveBeenCalledOnce();
    expect(actions.openSettings).toHaveBeenCalledOnce();
  });

  it("splits vertical on Cmd+D and horizontal on Cmd+Shift+D", () => {
    press("KeyD", { metaKey: true });
    press("KeyD", { metaKey: true, shiftKey: true });
    expect(actions.splitPane).toHaveBeenNthCalledWith(1, "vertical");
    expect(actions.splitPane).toHaveBeenNthCalledWith(2, "horizontal");
  });

  it("focuses panes with Cmd+Alt+Arrow", () => {
    press("ArrowLeft", { metaKey: true, altKey: true });
    press("ArrowRight", { metaKey: true, altKey: true });
    expect(actions.focusPane).toHaveBeenNthCalledWith(1, "left");
    expect(actions.focusPane).toHaveBeenNthCalledWith(2, "right");
  });

  it("cycles panes with Cmd+] / Cmd+[", () => {
    press("BracketRight", { metaKey: true });
    press("BracketLeft", { metaKey: true });
    expect(actions.cyclePane).toHaveBeenNthCalledWith(1, 1);
    expect(actions.cyclePane).toHaveBeenNthCalledWith(2, -1);
  });

  it("selects tabs by number and cycles with Ctrl+Tab / Cmd+Shift+brackets", () => {
    press("Digit3", { metaKey: true });
    expect(actions.selectTab).toHaveBeenCalledWith(3);
    press("Tab", { ctrlKey: true });
    press("Tab", { ctrlKey: true, shiftKey: true });
    expect(actions.cycleTab).toHaveBeenNthCalledWith(1, 1);
    expect(actions.cycleTab).toHaveBeenNthCalledWith(2, -1);
    press("BracketRight", { metaKey: true, shiftKey: true });
    expect(actions.cycleTab).toHaveBeenNthCalledWith(3, 1);
  });

  it("toggles fullscreen on Cmd+F and Cmd+Enter", () => {
    press("KeyF", { metaKey: true });
    press("Enter", { metaKey: true });
    expect(actions.toggleFullscreen).toHaveBeenCalledTimes(2);
  });

  it("ignores keys without the meta/ctrl modifiers", () => {
    press("KeyT");
    expect(actions.newTab).not.toHaveBeenCalled();
  });

  it("stops firing after dispose", () => {
    dispose();
    press("KeyT", { metaKey: true });
    expect(actions.newTab).not.toHaveBeenCalled();
    dispose = () => {}; // afterEach no-op
  });
});
