import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { HelpOverlay } from "./help-overlay";

const HIDDEN = "help-overlay--hidden";

describe("HelpOverlay", () => {
  let overlay: HelpOverlay;

  beforeEach(() => {
    overlay = new HelpOverlay();
    document.body.appendChild(overlay.element);
  });

  afterEach(() => {
    overlay.element.remove();
    document.body.textContent = "";
  });

  describe("visibility", () => {
    it("starts hidden", () => {
      expect(overlay.element.classList.contains(HIDDEN)).toBe(true);
    });

    it("show() reveals it", () => {
      overlay.show();
      expect(overlay.element.classList.contains(HIDDEN)).toBe(false);
    });

    it("hide() hides it again", () => {
      overlay.show();
      overlay.hide();
      expect(overlay.element.classList.contains(HIDDEN)).toBe(true);
    });

    it("toggle() flips visibility", () => {
      overlay.toggle();
      expect(overlay.element.classList.contains(HIDDEN)).toBe(false);
      overlay.toggle();
      expect(overlay.element.classList.contains(HIDDEN)).toBe(true);
    });
  });

  describe("backdrop click", () => {
    it("hides when the backdrop element itself is clicked", () => {
      overlay.show();
      overlay.element.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
      expect(overlay.element.classList.contains(HIDDEN)).toBe(true);
    });

    it("does not hide when the inner card is clicked", () => {
      overlay.show();
      const card = overlay.element.querySelector<HTMLDivElement>(".help-card")!;
      card.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
      expect(overlay.element.classList.contains(HIDDEN)).toBe(false);
    });
  });

  describe("Escape key", () => {
    it("hides when Escape is pressed while visible", () => {
      overlay.show();
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
      expect(overlay.element.classList.contains(HIDDEN)).toBe(true);
    });

    it("does nothing when Escape is pressed while hidden", () => {
      // Already hidden.
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
      expect(overlay.element.classList.contains(HIDDEN)).toBe(true);
    });

    it("ignores non-Escape keys while visible", () => {
      overlay.show();
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
      expect(overlay.element.classList.contains(HIDDEN)).toBe(false);
    });
  });

  describe("content", () => {
    it("renders the title", () => {
      const title = overlay.element.querySelector(".help-title");
      expect(title?.textContent).toBe("Keyboard shortcuts");
    });

    it("renders shortcut groups and key labels", () => {
      const text = overlay.element.textContent ?? "";
      expect(text).toContain("Windows & Tabs");
      expect(text).toContain("Panes");
      expect(text).toContain("Terminal");

      const keys = Array.from(overlay.element.querySelectorAll("kbd.help-keys")).map(
        (k) => k.textContent,
      );
      expect(keys).toContain("⌘T");
      expect(keys).toContain("⌘K");
      expect(keys.length).toBeGreaterThan(3);
    });

    it("renders the close hint", () => {
      const hint = overlay.element.querySelector(".help-hint");
      expect(hint?.textContent).toBe("⌘/ or Esc to close");
    });
  });
});
