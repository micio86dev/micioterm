import type { PaletteConfig, ProfileConfig, TerminalConfig } from "../config/config";
import { activeProfile } from "../config/config";
import {
  duplicateProfile,
  removeProfile,
  renameProfile,
  setActiveProfile,
  updateProfile,
} from "../core/profiles";

export interface SettingsPanelCallbacks {
  /** Live-preview the draft config (applied to the running UI, not persisted). */
  onPreview: (config: TerminalConfig) => void;
  /** Persist the draft config to disk. Debounced by the panel. */
  onCommit: (config: TerminalConfig) => void;
}

/** Common monospace fonts offered as autocomplete in the font field. */
const FONT_SUGGESTIONS = [
  "JetBrains Mono",
  "Fira Code",
  "SF Mono",
  "Menlo",
  "Monaco",
  "Cascadia Code",
  "Hack",
  "Source Code Pro",
  "IBM Plex Mono",
  "Roboto Mono",
];

/** Palette entries in display order: label + the config key it edits. */
const PALETTE_FIELDS: { key: keyof PaletteConfig; label: string }[] = [
  { key: "foreground", label: "Foreground" },
  { key: "cursor", label: "Cursor" },
  { key: "black", label: "Black" },
  { key: "red", label: "Red" },
  { key: "green", label: "Green" },
  { key: "yellow", label: "Yellow" },
  { key: "blue", label: "Blue" },
  { key: "magenta", label: "Magenta" },
  { key: "cyan", label: "Cyan" },
  { key: "white", label: "White" },
  { key: "bright_black", label: "Br. Black" },
  { key: "bright_red", label: "Br. Red" },
  { key: "bright_green", label: "Br. Green" },
  { key: "bright_yellow", label: "Br. Yellow" },
  { key: "bright_blue", label: "Br. Blue" },
  { key: "bright_magenta", label: "Br. Magenta" },
  { key: "bright_cyan", label: "Br. Cyan" },
  { key: "bright_white", label: "Br. White" },
];

function newProfileId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `profile-${Date.now()}`;
}

/**
 * iTerm2-style Preferences (⌘,): a profile list on the left, a style editor on
 * the right. Edits are applied live and saved automatically (debounced). The
 * selected profile in the list is the app-wide active profile.
 */
export class SettingsPanel {
  readonly element: HTMLDivElement;

  private readonly sidebar: HTMLDivElement;
  private readonly form: HTMLDivElement;
  private draft!: TerminalConfig;
  private visible = false;
  private pendingSave = false;
  private commitTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly callbacks: SettingsPanelCallbacks) {
    this.element = document.createElement("div");
    this.element.className = "settings-overlay settings-overlay--hidden";

    const card = document.createElement("div");
    card.className = "settings-card";

    card.appendChild(this.buildHeader());

    const body = document.createElement("div");
    body.className = "settings-body";

    this.sidebar = document.createElement("div");
    this.sidebar.className = "settings-sidebar";

    this.form = document.createElement("div");
    this.form.className = "settings-form";

    body.append(this.sidebar, this.form);
    card.appendChild(body);

    const hint = document.createElement("div");
    hint.className = "settings-hint";
    hint.textContent = "Changes apply live and are saved automatically · Esc to close";
    card.appendChild(hint);

    this.element.appendChild(card);

    // Backdrop click (outside the card) closes.
    this.element.addEventListener("mousedown", (event) => {
      if (event.target === this.element) {
        this.close();
      }
    });

    // Esc closes only while open, so it otherwise flows to the terminal.
    window.addEventListener(
      "keydown",
      (event) => {
        if (this.visible && event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          this.close();
        }
      },
      true,
    );
  }

  /** Open the panel editing a snapshot of the current config. */
  open(config: TerminalConfig): void {
    this.draft = config;
    // Fresh draft equals what's on disk — nothing to save until an edit.
    this.pendingSave = false;
    this.renderSidebar();
    this.renderForm();
    this.visible = true;
    this.element.classList.remove("settings-overlay--hidden");
  }

  close(): void {
    if (!this.visible) {
      return;
    }
    // Flush a pending debounced save, but never write when nothing changed.
    clearTimeout(this.commitTimer);
    if (this.pendingSave) {
      this.callbacks.onCommit(this.draft);
      this.pendingSave = false;
    }
    this.visible = false;
    this.element.classList.add("settings-overlay--hidden");
  }

  toggle(config: TerminalConfig): void {
    if (this.visible) {
      this.close();
    } else {
      this.open(config);
    }
  }

  // --- mutation + live apply --------------------------------------------------

  /** Replace the draft, apply it live now, and schedule a debounced save. */
  private commit(next: TerminalConfig): void {
    this.draft = next;
    this.callbacks.onPreview(next);
    this.pendingSave = true;
    clearTimeout(this.commitTimer);
    this.commitTimer = setTimeout(() => {
      this.callbacks.onCommit(this.draft);
      this.pendingSave = false;
    }, 250);
  }

  private active(): ProfileConfig {
    return activeProfile(this.draft);
  }

  private editActive(patch: Partial<Omit<ProfileConfig, "id">>): void {
    this.commit(updateProfile(this.draft, this.draft.active_profile_id, patch));
  }

  // --- sidebar ---------------------------------------------------------------

  private renderSidebar(): void {
    this.sidebar.textContent = "";

    const title = document.createElement("div");
    title.className = "settings-sidebar__title";
    title.textContent = "Profiles";
    this.sidebar.appendChild(title);

    const list = document.createElement("div");
    list.className = "settings-profile-list";
    for (const profile of this.draft.profiles) {
      list.appendChild(this.renderProfileItem(profile));
    }
    this.sidebar.appendChild(list);

    const actions = document.createElement("div");
    actions.className = "settings-profile-actions";

    actions.appendChild(
      this.smallButton("+ New", "Create a new profile", () => this.createProfile()),
    );
    actions.appendChild(
      this.smallButton("Duplicate", "Duplicate the selected profile", () =>
        this.duplicateActive(),
      ),
    );
    const del = this.smallButton("Delete", "Delete the selected profile", () =>
      this.deleteActive(),
    );
    del.disabled = this.draft.profiles.length <= 1;
    actions.appendChild(del);

    this.sidebar.appendChild(actions);
  }

  private renderProfileItem(profile: ProfileConfig): HTMLButtonElement {
    const item = document.createElement("button");
    item.type = "button";
    const active = profile.id === this.draft.active_profile_id;
    item.className = active
      ? "settings-profile-item settings-profile-item--active"
      : "settings-profile-item";
    item.dataset.profileId = profile.id;
    item.textContent = profile.name || "(unnamed)";
    item.addEventListener("click", () => this.selectProfile(profile.id));
    return item;
  }

  private selectProfile(id: string): void {
    if (id === this.draft.active_profile_id) {
      return;
    }
    this.commit(setActiveProfile(this.draft, id));
    this.renderSidebar();
    this.renderForm();
  }

  private createProfile(): void {
    const id = newProfileId();
    const base = this.active();
    let next = duplicateProfile(this.draft, base.id, id, `${base.name} copy`);
    next = setActiveProfile(next, id);
    this.commit(next);
    this.renderSidebar();
    this.renderForm();
  }

  private duplicateActive(): void {
    this.createProfile();
  }

  private deleteActive(): void {
    if (this.draft.profiles.length <= 1) {
      return;
    }
    this.commit(removeProfile(this.draft, this.draft.active_profile_id));
    this.renderSidebar();
    this.renderForm();
  }

  // --- form ------------------------------------------------------------------

  private renderForm(): void {
    this.form.textContent = "";
    const profile = this.active();

    this.form.appendChild(this.section("Profile"));
    this.form.appendChild(
      this.field(
        "Name",
        this.textInput(profile.name, (value) => {
          this.commit(renameProfile(this.draft, this.draft.active_profile_id, value));
          this.refreshSidebarLabels();
        }),
      ),
    );

    this.form.appendChild(this.section("Text"));
    this.form.appendChild(
      this.field("Font", this.fontInput(profile.font_family)),
    );
    this.form.appendChild(
      this.field(
        "Font size",
        this.rangeInput(8, 32, 1, profile.font_size, (value) => this.editActive({ font_size: value }), (v) => `${v}px`),
      ),
    );

    this.form.appendChild(this.section("Background"));
    this.form.appendChild(
      this.field(
        "Opacity",
        this.rangeInput(0, 1, 0.01, profile.opacity, (value) => this.editActive({ opacity: value }), (v) => `${Math.round(v * 100)}%`),
      ),
    );
    this.form.appendChild(
      this.field(
        "Blur",
        this.selectInput(
          [
            { value: "hud", label: "HUD (darker)" },
            { value: "under-window", label: "Under window" },
          ],
          profile.blur_material,
          (value) => this.editActive({ blur_material: value }),
        ),
      ),
    );
    this.form.appendChild(
      this.field(
        "Cursor blink",
        this.checkboxInput(profile.cursor_blink, (value) => this.editActive({ cursor_blink: value })),
      ),
    );

    this.form.appendChild(this.section("Colors"));
    this.form.appendChild(this.paletteGrid(profile.palette));
  }

  /** Refresh only the profile-name labels in the sidebar (no full rebuild). */
  private refreshSidebarLabels(): void {
    for (const profile of this.draft.profiles) {
      const item = this.sidebar.querySelector<HTMLButtonElement>(
        `.settings-profile-item[data-profile-id="${profile.id}"]`,
      );
      if (item) {
        item.textContent = profile.name || "(unnamed)";
      }
    }
  }

  private paletteGrid(palette: PaletteConfig): HTMLDivElement {
    const grid = document.createElement("div");
    grid.className = "settings-palette";
    for (const { key, label } of PALETTE_FIELDS) {
      grid.appendChild(this.colorSwatch(label, palette[key], (value) => this.editColor(key, value)));
    }
    return grid;
  }

  private editColor(key: keyof PaletteConfig, value: string): void {
    const palette = { ...this.active().palette, [key]: value };
    this.editActive({ palette });
  }

  // --- small DOM builders ----------------------------------------------------

  private buildHeader(): HTMLDivElement {
    const header = document.createElement("div");
    header.className = "settings-header";

    const title = document.createElement("div");
    title.className = "settings-title";
    title.textContent = "Preferences";

    const close = document.createElement("button");
    close.type = "button";
    close.className = "settings-close";
    close.textContent = "×";
    close.title = "Close (Esc)";
    close.addEventListener("click", () => this.close());

    header.append(title, close);
    return header;
  }

  private section(name: string): HTMLDivElement {
    const el = document.createElement("div");
    el.className = "settings-section";
    el.textContent = name;
    return el;
  }

  private field(label: string, control: HTMLElement): HTMLDivElement {
    const row = document.createElement("div");
    row.className = "settings-row";
    const labelEl = document.createElement("label");
    labelEl.className = "settings-label";
    labelEl.textContent = label;
    row.append(labelEl, control);
    return row;
  }

  private smallButton(text: string, title: string, onClick: () => void): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "settings-btn";
    button.textContent = text;
    button.title = title;
    button.addEventListener("click", onClick);
    return button;
  }

  private textInput(value: string, onInput: (value: string) => void): HTMLInputElement {
    const input = document.createElement("input");
    input.type = "text";
    input.className = "settings-input";
    input.value = value;
    input.addEventListener("input", () => onInput(input.value));
    return input;
  }

  private fontInput(value: string): HTMLDivElement {
    const wrap = document.createElement("div");
    wrap.className = "settings-input-wrap";

    const input = this.textInput(value, (v) => this.editActive({ font_family: v }));
    const listId = "settings-font-suggestions";
    input.setAttribute("list", listId);

    let datalist = document.getElementById(listId) as HTMLDataListElement | null;
    if (!datalist) {
      datalist = document.createElement("datalist");
      datalist.id = listId;
      for (const font of FONT_SUGGESTIONS) {
        const option = document.createElement("option");
        option.value = font;
        datalist.appendChild(option);
      }
    }
    wrap.append(input, datalist);
    return wrap;
  }

  private rangeInput(
    min: number,
    max: number,
    step: number,
    value: number,
    onInput: (value: number) => void,
    format: (value: number) => string,
  ): HTMLDivElement {
    const wrap = document.createElement("div");
    wrap.className = "settings-input-wrap settings-range-wrap";

    const input = document.createElement("input");
    input.type = "range";
    input.className = "settings-range";
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    input.value = String(value);

    const readout = document.createElement("span");
    readout.className = "settings-readout";
    readout.textContent = format(value);

    input.addEventListener("input", () => {
      const next = Number(input.value);
      readout.textContent = format(next);
      onInput(next);
    });

    wrap.append(input, readout);
    return wrap;
  }

  private selectInput(
    options: { value: string; label: string }[],
    value: string,
    onChange: (value: string) => void,
  ): HTMLSelectElement {
    const select = document.createElement("select");
    select.className = "settings-input settings-select";
    for (const option of options) {
      const el = document.createElement("option");
      el.value = option.value;
      el.textContent = option.label;
      if (option.value === value) {
        el.selected = true;
      }
      select.appendChild(el);
    }
    select.addEventListener("change", () => onChange(select.value));
    return select;
  }

  private checkboxInput(checked: boolean, onChange: (checked: boolean) => void): HTMLInputElement {
    const input = document.createElement("input");
    input.type = "checkbox";
    input.className = "settings-checkbox";
    input.checked = checked;
    input.addEventListener("change", () => onChange(input.checked));
    return input;
  }

  private colorSwatch(
    label: string,
    value: string,
    onInput: (value: string) => void,
  ): HTMLLabelElement {
    const wrap = document.createElement("label");
    wrap.className = "settings-swatch";

    const input = document.createElement("input");
    input.type = "color";
    input.className = "settings-swatch__input";
    // <input type=color> only accepts #rrggbb; non-hex values (e.g. the rgba
    // selection color) get a sane fallback and are left to the config file.
    input.value = /^#[0-9a-fA-F]{6}$/.test(value) ? value : "#000000";
    input.addEventListener("input", () => onInput(input.value));

    const name = document.createElement("span");
    name.className = "settings-swatch__label";
    name.textContent = label;

    wrap.append(input, name);
    return wrap;
  }
}
