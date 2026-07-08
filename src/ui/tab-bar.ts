import type { Tab } from "../core/tabs";
import logoUrl from "../assets/miciodev-logo.jpg";

export interface TabBarCallbacks {
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  onNew: () => void;
  onSettings: () => void;
  onRename: (id: string, title: string) => void;
}

/** Renders the tab strip. Pure view: it reads tab state and emits intents. */
export class TabBar {
  readonly element: HTMLDivElement;
  private readonly list: HTMLDivElement;

  constructor(private readonly callbacks: TabBarCallbacks) {
    this.element = document.createElement("div");
    this.element.className = "tab-bar";

    // Logo slot (left). Replace src/assets/miciodev-logo.svg with the real mark.
    const logo = document.createElement("img");
    logo.className = "tab-bar__logo";
    logo.src = logoUrl;
    logo.alt = "MicioDev";
    logo.draggable = false;

    this.list = document.createElement("div");
    this.list.className = "tab-bar__tabs";

    const settingsButton = document.createElement("button");
    settingsButton.type = "button";
    settingsButton.className = "tab-bar__settings";
    settingsButton.textContent = "⚙";
    settingsButton.title = "Preferences (⌘,)";
    settingsButton.addEventListener("click", () => this.callbacks.onSettings());

    const newButton = document.createElement("button");
    newButton.type = "button";
    newButton.className = "tab-bar__new";
    newButton.textContent = "+";
    newButton.title = "New tab (⌘T)";
    newButton.addEventListener("click", () => this.callbacks.onNew());

    this.element.append(logo, this.list, settingsButton, newButton);
  }

  render(tabs: readonly Tab[], activeId: string | null): void {
    this.list.textContent = "";
    for (const tab of tabs) {
      this.list.appendChild(this.renderTab(tab, tab.id === activeId));
    }
  }

  private renderTab(tab: Tab, active: boolean): HTMLDivElement {
    const el = document.createElement("div");
    el.className = active ? "tab tab--active" : "tab";
    // mousedown (not click) + preventDefault keeps terminal focus predictable.
    el.addEventListener("mousedown", (event) => {
      event.preventDefault();
      this.callbacks.onSelect(tab.id);
    });

    const label = document.createElement("span");
    label.className = "tab__label";
    label.textContent = tab.title;
    label.title = "Double-click to rename";
    // Double-click the title to rename the tab (e.g. label it with the project).
    label.addEventListener("dblclick", (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.beginRename(label, tab);
    });

    const close = document.createElement("button");
    close.type = "button";
    close.className = "tab__close";
    close.textContent = "×";
    close.title = "Close tab (⌘W)";
    close.addEventListener("mousedown", (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.callbacks.onClose(tab.id);
    });

    el.append(label, close);
    return el;
  }

  /** Replace a tab's label with an inline text field to rename it. */
  private beginRename(label: HTMLSpanElement, tab: Tab): void {
    const input = document.createElement("input");
    input.type = "text";
    input.className = "tab__rename";
    input.value = tab.title;

    let settled = false;
    const settle = (save: boolean): void => {
      if (settled) {
        return;
      }
      settled = true;
      const value = input.value.trim();
      input.replaceWith(label);
      if (save && value) {
        this.callbacks.onRename(tab.id, value);
      }
    };

    input.addEventListener("keydown", (event) => {
      event.stopPropagation();
      if (event.key === "Enter") {
        event.preventDefault();
        settle(true);
      } else if (event.key === "Escape") {
        event.preventDefault();
        settle(false);
      }
    });
    // Don't let clicks inside the field switch/close the tab.
    input.addEventListener("mousedown", (event) => event.stopPropagation());
    input.addEventListener("blur", () => settle(true));

    label.replaceWith(input);
    input.focus();
    input.select();
  }
}
