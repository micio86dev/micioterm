interface Shortcut {
  keys: string;
  action: string;
}

const GROUPS: { group: string; items: Shortcut[] }[] = [
  {
    group: "Windows & Tabs",
    items: [
      { keys: "⌘N", action: "New window" },
      { keys: "⌘T", action: "New tab" },
      { keys: "⌘1–⌘9", action: "Select tab (⌘9 = last)" },
      { keys: "⌃Tab · ⌘⇧] / ⌘⇧[", action: "Cycle tabs" },
    ],
  },
  {
    group: "Panes",
    items: [
      { keys: "⌘D", action: "Split left / right" },
      { keys: "⌘⇧D", action: "Split top / bottom" },
      { keys: "⌘] / ⌘[", action: "Next / previous pane" },
      { keys: "⌘⌥← ↑ → ↓", action: "Focus pane by direction" },
      { keys: "⌘W · ⌃D", action: "Close pane" },
    ],
  },
  {
    group: "Terminal",
    items: [
      { keys: "⌘K", action: "Clear terminal" },
      { keys: "⌘C / ⌘V", action: "Copy / paste" },
      { keys: "⌘F · ⌘↩", action: "Toggle fullscreen" },
      { keys: "⌘/", action: "Show / hide this help" },
    ],
  },
];

/** A dismissible keyboard-shortcuts cheat sheet (⌘/). */
export class HelpOverlay {
  readonly element: HTMLDivElement;
  private visible = false;

  constructor() {
    this.element = document.createElement("div");
    this.element.className = "help-overlay help-overlay--hidden";

    const card = document.createElement("div");
    card.className = "help-card";

    const title = document.createElement("div");
    title.className = "help-title";
    title.textContent = "Keyboard shortcuts";
    card.appendChild(title);

    const groups = document.createElement("div");
    groups.className = "help-groups";
    for (const { group, items } of GROUPS) {
      groups.appendChild(this.renderGroup(group, items));
    }
    card.appendChild(groups);

    const hint = document.createElement("div");
    hint.className = "help-hint";
    hint.textContent = "⌘/ or Esc to close";
    card.appendChild(hint);

    this.element.appendChild(card);

    // Click on the backdrop (not the card) closes.
    this.element.addEventListener("mousedown", (event) => {
      if (event.target === this.element) {
        this.hide();
      }
    });

    // Esc closes only while open; otherwise Esc flows to the terminal.
    window.addEventListener(
      "keydown",
      (event) => {
        if (this.visible && event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          this.hide();
        }
      },
      true,
    );
  }

  toggle(): void {
    if (this.visible) {
      this.hide();
    } else {
      this.show();
    }
  }

  show(): void {
    this.visible = true;
    this.element.classList.remove("help-overlay--hidden");
  }

  hide(): void {
    this.visible = false;
    this.element.classList.add("help-overlay--hidden");
  }

  private renderGroup(name: string, items: Shortcut[]): HTMLDivElement {
    const group = document.createElement("div");
    group.className = "help-group";

    const heading = document.createElement("div");
    heading.className = "help-group__name";
    heading.textContent = name;
    group.appendChild(heading);

    for (const { keys, action } of items) {
      const row = document.createElement("div");
      row.className = "help-row";
      const kbd = document.createElement("kbd");
      kbd.className = "help-keys";
      kbd.textContent = keys;
      const label = document.createElement("span");
      label.className = "help-action";
      label.textContent = action;
      row.append(kbd, label);
      group.appendChild(row);
    }
    return group;
  }
}
