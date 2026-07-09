import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Tab } from "../core/tabs";
import { TabBar, type TabBarCallbacks } from "./tab-bar";

function makeCallbacks() {
  return {
    onSelect: vi.fn(),
    onClose: vi.fn(),
    onNew: vi.fn(),
    onSettings: vi.fn(),
    onRename: vi.fn(),
  } satisfies TabBarCallbacks;
}

const TABS: Tab[] = [
  { id: "a", title: "First" },
  { id: "b", title: "Second" },
];

function mousedown(el: Element): void {
  el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
}

function dblclick(el: Element): void {
  el.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, cancelable: true }));
}

describe("TabBar", () => {
  let callbacks: ReturnType<typeof makeCallbacks>;
  let bar: TabBar;

  beforeEach(() => {
    callbacks = makeCallbacks();
    bar = new TabBar(callbacks);
    document.body.appendChild(bar.element);
  });

  afterEach(() => {
    bar.element.remove();
    document.body.textContent = "";
  });

  describe("constructor", () => {
    it("builds the tab-bar shell with logo, tab list, settings and new buttons", () => {
      expect(bar.element.className).toBe("tab-bar");

      const logo = bar.element.querySelector<HTMLImageElement>("img.tab-bar__logo");
      expect(logo).not.toBeNull();
      expect(logo?.alt).toBe("MicioDev");

      expect(bar.element.querySelector(".tab-bar__tabs")).not.toBeNull();

      const settings = bar.element.querySelector<HTMLButtonElement>(".tab-bar__settings");
      expect(settings?.textContent).toBe("⚙");

      const newButton = bar.element.querySelector<HTMLButtonElement>(".tab-bar__new");
      expect(newButton?.textContent).toBe("+");
    });

    it("fires onSettings when the ⚙ button is clicked", () => {
      const settings = bar.element.querySelector<HTMLButtonElement>(".tab-bar__settings");
      settings?.click();
      expect(callbacks.onSettings).toHaveBeenCalledTimes(1);
    });

    it("fires onNew when the + button is clicked", () => {
      const newButton = bar.element.querySelector<HTMLButtonElement>(".tab-bar__new");
      newButton?.click();
      expect(callbacks.onNew).toHaveBeenCalledTimes(1);
    });
  });

  describe("render", () => {
    it("renders one .tab per tab with label text = title", () => {
      bar.render(TABS, "a");
      const tabs = bar.element.querySelectorAll(".tab");
      expect(tabs.length).toBe(2);

      const labels = bar.element.querySelectorAll(".tab__label");
      expect(labels[0]?.textContent).toBe("First");
      expect(labels[1]?.textContent).toBe("Second");
    });

    it("marks .tab--active only on the active id", () => {
      bar.render(TABS, "b");
      const tabs = bar.element.querySelectorAll(".tab");
      expect(tabs[0]?.classList.contains("tab--active")).toBe(false);
      expect(tabs[1]?.classList.contains("tab--active")).toBe(true);
    });

    it("marks no tab active when activeId is null", () => {
      bar.render(TABS, null);
      expect(bar.element.querySelectorAll(".tab--active").length).toBe(0);
    });

    it("clears previous tabs on re-render", () => {
      bar.render(TABS, "a");
      bar.render([{ id: "c", title: "Only" }], "c");
      const tabs = bar.element.querySelectorAll(".tab");
      expect(tabs.length).toBe(1);
      expect(bar.element.querySelector(".tab__label")?.textContent).toBe("Only");
    });
  });

  describe("interaction", () => {
    it("fires onSelect(id) on tab mousedown", () => {
      bar.render(TABS, "a");
      const secondLabel = bar.element.querySelectorAll(".tab__label")[1]!;
      mousedown(secondLabel);
      expect(callbacks.onSelect).toHaveBeenCalledTimes(1);
      expect(callbacks.onSelect).toHaveBeenCalledWith("b");
    });

    it("fires onClose(id) on .tab__close mousedown", () => {
      bar.render(TABS, "a");
      const firstClose = bar.element.querySelectorAll(".tab__close")[0]!;
      mousedown(firstClose);
      expect(callbacks.onClose).toHaveBeenCalledTimes(1);
      expect(callbacks.onClose).toHaveBeenCalledWith("a");
    });

    it("does not fire onSelect when closing (stopPropagation)", () => {
      bar.render(TABS, "a");
      const firstClose = bar.element.querySelectorAll(".tab__close")[0]!;
      mousedown(firstClose);
      expect(callbacks.onSelect).not.toHaveBeenCalled();
    });
  });

  describe("inline rename", () => {
    function beginRename(index = 0): HTMLInputElement {
      bar.render(TABS, "a");
      const label = bar.element.querySelectorAll<HTMLSpanElement>(".tab__label")[index]!;
      dblclick(label);
      const input = bar.element.querySelector<HTMLInputElement>(".tab__rename");
      expect(input).not.toBeNull();
      return input!;
    }

    it("replaces the label with an input prefilled with the current title", () => {
      const input = beginRename(0);
      expect(input.value).toBe("First");
      // Label is swapped out while editing.
      expect(bar.element.querySelectorAll(".tab__label").length).toBe(1);
    });

    it("commits on Enter and fires onRename(id, value)", () => {
      const input = beginRename(0);
      input.value = "Renamed";
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
      expect(callbacks.onRename).toHaveBeenCalledTimes(1);
      expect(callbacks.onRename).toHaveBeenCalledWith("a", "Renamed");
      // Input is removed, label restored.
      expect(bar.element.querySelector(".tab__rename")).toBeNull();
    });

    it("trims the committed value", () => {
      const input = beginRename(0);
      input.value = "  Padded  ";
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
      expect(callbacks.onRename).toHaveBeenCalledWith("a", "Padded");
    });

    it("cancels on Escape without firing onRename", () => {
      const input = beginRename(0);
      input.value = "Ignored";
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      expect(callbacks.onRename).not.toHaveBeenCalled();
      expect(bar.element.querySelector(".tab__rename")).toBeNull();
      expect(bar.element.querySelectorAll(".tab__label").length).toBe(2);
    });

    it("commits on blur", () => {
      const input = beginRename(1);
      input.value = "BlurName";
      input.dispatchEvent(new Event("blur"));
      expect(callbacks.onRename).toHaveBeenCalledTimes(1);
      expect(callbacks.onRename).toHaveBeenCalledWith("b", "BlurName");
    });

    it("does not fire onRename for an empty value", () => {
      const input = beginRename(0);
      input.value = "   ";
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
      expect(callbacks.onRename).not.toHaveBeenCalled();
    });

    it("settles once: Enter then blur fires onRename only once", () => {
      const input = beginRename(0);
      input.value = "Once";
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
      input.dispatchEvent(new Event("blur"));
      expect(callbacks.onRename).toHaveBeenCalledTimes(1);
    });

    it("ignores unrelated keys while editing", () => {
      const input = beginRename(0);
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "a", bubbles: true }));
      expect(callbacks.onRename).not.toHaveBeenCalled();
      // Still editing.
      expect(bar.element.querySelector(".tab__rename")).not.toBeNull();
    });
  });
});
