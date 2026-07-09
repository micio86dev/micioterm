import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { PaletteConfig, ProfileConfig, TerminalConfig } from "../config/config";
import { SettingsPanel, type SettingsPanelCallbacks } from "./settings-panel";

// --- fixtures ---------------------------------------------------------------

/** A palette with valid #rrggbb hex values for every key the panel renders. */
function makePalette(overrides: Partial<PaletteConfig> = {}): PaletteConfig {
  return {
    foreground: "#c0c0c0",
    cursor: "#ffffff",
    selection: "rgba(255,255,255,0.3)", // not rendered as a swatch
    black: "#000000",
    red: "#ff0000",
    green: "#00ff00",
    yellow: "#ffff00",
    blue: "#0000ff",
    magenta: "#ff00ff",
    cyan: "#00ffff",
    white: "#ffffff",
    bright_black: "#555555",
    bright_red: "#ff5555",
    bright_green: "#55ff55",
    bright_yellow: "#ffff55",
    bright_blue: "#5555ff",
    bright_magenta: "#ff55ff",
    bright_cyan: "#55ffff",
    bright_white: "#ffffff",
    ...overrides,
  };
}

function makeProfile(overrides: Partial<ProfileConfig> = {}): ProfileConfig {
  return {
    id: "p1",
    name: "Default",
    opacity: 0.9,
    blur_material: "hud",
    font_family: "JetBrains Mono",
    font_size: 14,
    cursor_blink: true,
    palette: makePalette(),
    ...overrides,
  };
}

/** Build a TerminalConfig with 1 or 2 profiles; first profile is active. */
function makeConfig(profiles?: ProfileConfig[]): TerminalConfig {
  const list = profiles ?? [
    makeProfile(),
    makeProfile({ id: "p2", name: "Second", opacity: 0.5, blur_material: "under-window" }),
  ];
  return {
    active_profile_id: list[0].id,
    watermark: true,
    show_banner: false,
    default_shell: null,
    scrollback: 10000,
    profiles: list,
  };
}

// --- query helpers ----------------------------------------------------------

const q = <T extends Element>(root: ParentNode, sel: string): T => {
  const el = root.querySelector<T>(sel);
  if (!el) throw new Error(`missing element: ${sel}`);
  return el;
};
const qa = <T extends Element>(root: ParentNode, sel: string): T[] =>
  Array.from(root.querySelectorAll<T>(sel));

const fireInput = (el: HTMLElement) =>
  el.dispatchEvent(new Event("input", { bubbles: true }));
const fireChange = (el: HTMLElement) =>
  el.dispatchEvent(new Event("change", { bubbles: true }));

// --- suite ------------------------------------------------------------------

describe("SettingsPanel", () => {
  let panel: SettingsPanel;
  let onPreview: ReturnType<typeof vi.fn>;
  let onCommit: ReturnType<typeof vi.fn>;
  let callbacks: SettingsPanelCallbacks;

  const lastPreview = (): TerminalConfig =>
    onPreview.mock.calls.at(-1)![0] as TerminalConfig;
  const activeOf = (cfg: TerminalConfig): ProfileConfig =>
    cfg.profiles.find((p) => p.id === cfg.active_profile_id)!;

  beforeEach(() => {
    vi.useFakeTimers();
    onPreview = vi.fn();
    onCommit = vi.fn();
    callbacks = { onPreview, onCommit } as SettingsPanelCallbacks;
    panel = new SettingsPanel(callbacks);
    document.body.appendChild(panel.element);
  });

  afterEach(() => {
    panel.element.remove();
    document.body.innerHTML = "";
    vi.useRealTimers();
  });

  // --- open / render --------------------------------------------------------

  describe("open()", () => {
    it("starts hidden before open", () => {
      expect(panel.element.classList.contains("settings-overlay--hidden")).toBe(true);
    });

    it("becomes visible on open", () => {
      panel.open(makeConfig());
      expect(panel.element.classList.contains("settings-overlay--hidden")).toBe(false);
    });

    it("renders one profile item per profile and marks the active one", () => {
      panel.open(makeConfig());
      const items = qa<HTMLButtonElement>(panel.element, ".settings-profile-item");
      expect(items).toHaveLength(2);
      const active = items.filter((i) =>
        i.classList.contains("settings-profile-item--active"),
      );
      expect(active).toHaveLength(1);
      expect(active[0].dataset.profileId).toBe("p1");
      expect(items.map((i) => i.textContent)).toEqual(["Default", "Second"]);
    });

    it("renders the form for the active profile", () => {
      panel.open(makeConfig());
      // name input (first text input)
      const nameInput = q<HTMLInputElement>(panel.element, ".settings-input[type='text']");
      expect(nameInput.value).toBe("Default");
      // two ranges: font-size then opacity
      const ranges = qa<HTMLInputElement>(panel.element, ".settings-range");
      expect(ranges).toHaveLength(2);
      expect(ranges[0].value).toBe("14"); // font-size
      expect(ranges[1].value).toBe("0.9"); // opacity
      // blur select
      const select = q<HTMLSelectElement>(panel.element, ".settings-select");
      expect(select.value).toBe("hud");
      // cursor checkbox
      const check = q<HTMLInputElement>(panel.element, ".settings-checkbox");
      expect(check.checked).toBe(true);
      // color swatches: one per PALETTE_FIELDS entry (18, selection excluded)
      const swatches = qa<HTMLInputElement>(panel.element, ".settings-swatch__input");
      expect(swatches).toHaveLength(18);
    });

    it("falls back to #000000 for non-hex swatch values", () => {
      // foreground is valid hex; make one invalid to exercise the fallback.
      const cfg = makeConfig([makeProfile({ palette: makePalette({ foreground: "rgb(1,2,3)" }) })]);
      panel.open(cfg);
      const swatches = qa<HTMLInputElement>(panel.element, ".settings-swatch__input");
      // first swatch is "foreground" per PALETTE_FIELDS order
      expect(swatches[0].value).toBe("#000000");
    });
  });

  // --- live preview + debounced commit --------------------------------------

  describe("editing a form field", () => {
    beforeEach(() => panel.open(makeConfig()));

    it("calls onPreview immediately with an updated opacity draft", () => {
      const ranges = qa<HTMLInputElement>(panel.element, ".settings-range");
      const opacity = ranges[1];
      opacity.value = "0.42";
      fireInput(opacity);

      expect(onPreview).toHaveBeenCalledTimes(1);
      expect(activeOf(lastPreview()).opacity).toBeCloseTo(0.42);
    });

    it("does not commit until the debounce elapses, then commits once", () => {
      const ranges = qa<HTMLInputElement>(panel.element, ".settings-range");
      ranges[1].value = "0.3";
      fireInput(ranges[1]);

      expect(onCommit).not.toHaveBeenCalled();
      vi.advanceTimersByTime(249);
      expect(onCommit).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1);
      expect(onCommit).toHaveBeenCalledTimes(1);
      expect(activeOf(onCommit.mock.calls[0][0] as TerminalConfig).opacity).toBeCloseTo(0.3);
    });

    it("coalesces rapid edits into a single debounced commit", () => {
      const ranges = qa<HTMLInputElement>(panel.element, ".settings-range");
      const opacity = ranges[1];
      for (const v of ["0.2", "0.4", "0.6"]) {
        opacity.value = v;
        fireInput(opacity);
        vi.advanceTimersByTime(100); // less than 250 each time
      }
      expect(onCommit).not.toHaveBeenCalled();
      vi.advanceTimersByTime(250);
      expect(onCommit).toHaveBeenCalledTimes(1);
      expect(activeOf(onCommit.mock.calls[0][0] as TerminalConfig).opacity).toBeCloseTo(0.6);
    });

    it("updates the readout label as the range moves", () => {
      const ranges = qa<HTMLInputElement>(panel.element, ".settings-range");
      const opacity = ranges[1];
      const readout = q<HTMLSpanElement>(
        opacity.closest(".settings-range-wrap")!,
        ".settings-readout",
      );
      opacity.value = "0.5";
      fireInput(opacity);
      expect(readout.textContent).toBe("50%");
    });

    it("updates font size via its range", () => {
      const ranges = qa<HTMLInputElement>(panel.element, ".settings-range");
      const fontSize = ranges[0];
      fontSize.value = "20";
      fireInput(fontSize);
      expect(activeOf(lastPreview()).font_size).toBe(20);
    });

    it("updates the font family via the font text field", () => {
      const inputs = qa<HTMLInputElement>(panel.element, ".settings-input[type='text']");
      const font = inputs[1]; // [0] is name, [1] is font
      font.value = "Fira Code";
      fireInput(font);
      expect(activeOf(lastPreview()).font_family).toBe("Fira Code");
    });
  });

  // --- name rename ----------------------------------------------------------

  describe("renaming the active profile", () => {
    beforeEach(() => panel.open(makeConfig()));

    it("previews a renamed draft and updates the sidebar label", () => {
      const nameInput = q<HTMLInputElement>(panel.element, ".settings-input[type='text']");
      nameInput.value = "My Profile";
      fireInput(nameInput);

      expect(activeOf(lastPreview()).name).toBe("My Profile");
      const activeItem = q<HTMLButtonElement>(
        panel.element,
        ".settings-profile-item--active",
      );
      expect(activeItem.textContent).toBe("My Profile");
    });
  });

  // --- profile selection ----------------------------------------------------

  describe("selecting a profile in the sidebar", () => {
    beforeEach(() => panel.open(makeConfig()));

    it("makes the clicked profile active and re-renders the form", () => {
      const items = qa<HTMLButtonElement>(panel.element, ".settings-profile-item");
      items[1].click(); // "Second"

      expect(lastPreview().active_profile_id).toBe("p2");
      // sidebar reflects new active
      const active = q<HTMLButtonElement>(panel.element, ".settings-profile-item--active");
      expect(active.dataset.profileId).toBe("p2");
      // form re-rendered for p2 (opacity 0.5)
      const ranges = qa<HTMLInputElement>(panel.element, ".settings-range");
      expect(ranges[1].value).toBe("0.5");
      const nameInput = q<HTMLInputElement>(panel.element, ".settings-input[type='text']");
      expect(nameInput.value).toBe("Second");
    });

    it("does nothing when clicking the already-active profile", () => {
      const items = qa<HTMLButtonElement>(panel.element, ".settings-profile-item");
      items[0].click(); // already active
      expect(onPreview).not.toHaveBeenCalled();
    });
  });

  // --- create / duplicate / delete ------------------------------------------

  describe("profile management", () => {
    const btn = (label: string): HTMLButtonElement => {
      const b = qa<HTMLButtonElement>(panel.element, ".settings-btn").find(
        (x) => x.textContent === label,
      );
      if (!b) throw new Error(`no button ${label}`);
      return b;
    };

    it("+ New creates a new active profile and grows the list", () => {
      panel.open(makeConfig());
      btn("+ New").click();

      const cfg = lastPreview();
      expect(cfg.profiles).toHaveLength(3);
      // the new profile is active and is a copy of the previously-active one
      const active = activeOf(cfg);
      expect(active.name).toBe("Default copy");
      // sidebar grew too
      expect(qa(panel.element, ".settings-profile-item")).toHaveLength(3);
    });

    it("Duplicate also creates a new active copy", () => {
      panel.open(makeConfig());
      btn("Duplicate").click();
      const cfg = lastPreview();
      expect(cfg.profiles).toHaveLength(3);
      expect(activeOf(cfg).name).toBe("Default copy");
    });

    it("Delete removes the active profile", () => {
      panel.open(makeConfig());
      btn("Delete").click();

      const cfg = lastPreview();
      expect(cfg.profiles).toHaveLength(1);
      expect(cfg.profiles[0].id).toBe("p2");
      expect(cfg.active_profile_id).toBe("p2");
      expect(qa(panel.element, ".settings-profile-item")).toHaveLength(1);
    });

    it("disables Delete when only one profile remains", () => {
      panel.open(makeConfig([makeProfile()]));
      expect(btn("Delete").disabled).toBe(true);
    });

    it("enables Delete with more than one profile", () => {
      panel.open(makeConfig());
      expect(btn("Delete").disabled).toBe(false);
    });
  });

  // --- color swatch ---------------------------------------------------------

  describe("color swatch", () => {
    beforeEach(() => panel.open(makeConfig()));

    it("updates the active profile's palette in the preview draft", () => {
      const swatches = qa<HTMLInputElement>(panel.element, ".settings-swatch__input");
      const foreground = swatches[0]; // first is "foreground"
      foreground.value = "#123456";
      fireInput(foreground);

      expect(activeOf(lastPreview()).palette.foreground).toBe("#123456");
    });

    it("does not disturb other palette keys", () => {
      const swatches = qa<HTMLInputElement>(panel.element, ".settings-swatch__input");
      swatches[3].value = "#abcdef"; // "red" (index 3 in PALETTE_FIELDS)
      fireInput(swatches[3]);
      const palette = activeOf(lastPreview()).palette;
      expect(palette.red).toBe("#abcdef");
      expect(palette.green).toBe("#00ff00");
    });
  });

  // --- blur select + cursor checkbox ----------------------------------------

  describe("blur and cursor controls", () => {
    beforeEach(() => panel.open(makeConfig()));

    it("updates blur material via the select", () => {
      const select = q<HTMLSelectElement>(panel.element, ".settings-select");
      select.value = "under-window";
      fireChange(select);
      expect(activeOf(lastPreview()).blur_material).toBe("under-window");
    });

    it("updates cursor_blink via the checkbox", () => {
      const check = q<HTMLInputElement>(panel.element, ".settings-checkbox");
      check.checked = false;
      fireChange(check);
      expect(activeOf(lastPreview()).cursor_blink).toBe(false);
    });
  });

  // --- close / dirty flush --------------------------------------------------

  describe("close()", () => {
    it("hides the panel", () => {
      panel.open(makeConfig());
      panel.close();
      expect(panel.element.classList.contains("settings-overlay--hidden")).toBe(true);
    });

    it("does not commit when closed without edits", () => {
      panel.open(makeConfig());
      panel.close();
      expect(onCommit).not.toHaveBeenCalled();
    });

    it("flushes a pending edit exactly once on close", () => {
      panel.open(makeConfig());
      const ranges = qa<HTMLInputElement>(panel.element, ".settings-range");
      ranges[1].value = "0.7";
      fireInput(ranges[1]);
      // close before the debounce fires
      panel.close();
      expect(onCommit).toHaveBeenCalledTimes(1);
      expect(activeOf(onCommit.mock.calls[0][0] as TerminalConfig).opacity).toBeCloseTo(0.7);

      // the cancelled debounce timer must not fire a second commit later
      vi.advanceTimersByTime(500);
      expect(onCommit).toHaveBeenCalledTimes(1);
    });

    it("is a no-op when called while already closed", () => {
      panel.close(); // never opened
      expect(panel.element.classList.contains("settings-overlay--hidden")).toBe(true);
      expect(onCommit).not.toHaveBeenCalled();
    });

    it("closes on Escape while open", () => {
      panel.open(makeConfig());
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
      expect(panel.element.classList.contains("settings-overlay--hidden")).toBe(true);
    });

    it("ignores Escape while closed", () => {
      panel.open(makeConfig());
      panel.close();
      onCommit.mockClear();
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
      // still hidden, no extra commit
      expect(panel.element.classList.contains("settings-overlay--hidden")).toBe(true);
      expect(onCommit).not.toHaveBeenCalled();
    });

    it("closes on backdrop (overlay) mousedown", () => {
      panel.open(makeConfig());
      const ev = new MouseEvent("mousedown", { bubbles: true });
      Object.defineProperty(ev, "target", { value: panel.element });
      panel.element.dispatchEvent(ev);
      expect(panel.element.classList.contains("settings-overlay--hidden")).toBe(true);
    });

    it("does not close when mousedown lands inside the card", () => {
      panel.open(makeConfig());
      const card = q<HTMLElement>(panel.element, ".settings-card");
      card.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
      expect(panel.element.classList.contains("settings-overlay--hidden")).toBe(false);
    });

    it("closes via the header close button", () => {
      panel.open(makeConfig());
      q<HTMLButtonElement>(panel.element, ".settings-close").click();
      expect(panel.element.classList.contains("settings-overlay--hidden")).toBe(true);
    });
  });

  // --- toggle ---------------------------------------------------------------

  describe("toggle()", () => {
    it("opens when closed and closes when open", () => {
      const cfg = makeConfig();
      panel.toggle(cfg);
      expect(panel.element.classList.contains("settings-overlay--hidden")).toBe(false);
      panel.toggle(cfg);
      expect(panel.element.classList.contains("settings-overlay--hidden")).toBe(true);
    });
  });
});
