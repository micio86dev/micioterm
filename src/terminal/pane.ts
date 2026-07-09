import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { WebglAddon } from "@xterm/addon-webgl";
import { CanvasAddon } from "@xterm/addon-canvas";
import type { UnlistenFn } from "@tauri-apps/api/event";
import "@xterm/xterm/css/xterm.css";

import type { ITheme } from "@xterm/xterm";

import { onPtyExit, onPtyOutput, ptyKill, ptyResize, ptySpawn, ptyWrite } from "./pty-bridge";
import { TERMINAL_FONT, TERMINAL_FONT_SIZE, xtermTheme } from "../theme/xterm-theme";

let fallbackCounter = 0;

/** A session id unique for the pane's whole lifetime (spec: one PTY per pane). */
function newSessionId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  fallbackCounter += 1;
  return `pane-${fallbackCounter}`;
}

export interface PaneOptions {
  shell?: string;
  cwd?: string;
  name?: string;
  scrollback?: number;
  fontFamily?: string;
  fontSize?: number;
  cursorBlink?: boolean;
  theme?: ITheme;
}

/** The live-updatable subset of {@link PaneOptions} — style, not shell/cwd. */
export type PaneStyle = Pick<PaneOptions, "fontFamily" | "fontSize" | "cursorBlink" | "theme">;

/**
 * One terminal pane: an xterm.js instance bound to exactly one backend PTY.
 * Keystrokes flow out via `pty_write`; shell output flows in on the pane's
 * `pty://output/<id>` event. The frontend never parses escape sequences.
 */
export class Pane {
  readonly sessionId: string;
  readonly element: HTMLDivElement;

  /** User-given label for the pane (e.g. the project). Empty when unset. */
  name: string;

  /** Called when the pane's shell exits (e.g. Ctrl+D). Set by the owner. */
  onExit?: () => void;
  /** Called after the user renames the pane, so the owner can re-snapshot. */
  onRename?: () => void;

  private readonly term: Terminal;
  private readonly fit: FitAddon;
  private readonly options: PaneOptions;
  private readonly nameChip: HTMLDivElement;
  /** Inner container xterm mounts into; its inset is the pane's inner padding. */
  private readonly viewport: HTMLDivElement;
  private unlisten?: UnlistenFn;
  private exitUnlisten?: UnlistenFn;
  private resizeObserver?: ResizeObserver;
  private disposed = false;

  constructor(options: PaneOptions = {}) {
    this.options = options;
    this.sessionId = newSessionId();
    this.name = options.name ?? "";

    this.element = document.createElement("div");
    this.element.className = "pane";

    // Inner container xterm renders into. Inset via CSS so FitAddon measures the
    // padded area (padding on `.pane` itself is not reliably subtracted by fit,
    // which clips edge text instead of shrinking the grid).
    this.viewport = document.createElement("div");
    this.viewport.className = "pane__terminal";
    this.element.appendChild(this.viewport);

    // Small name chip (top-left overlay). Double-click to label the pane.
    this.nameChip = document.createElement("div");
    this.nameChip.className = "pane__name";
    this.nameChip.title = "Name this pane (double-click)";
    this.nameChip.addEventListener("dblclick", (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.beginRename();
    });
    this.element.appendChild(this.nameChip);
    this.renderNameChip();

    this.term = new Terminal({
      allowProposedApi: true,
      // Solid blinking green block cursor (spec §4).
      cursorBlink: options.cursorBlink ?? true,
      cursorStyle: "block",
      scrollback: options.scrollback ?? 10_000,
      fontFamily: options.fontFamily ?? TERMINAL_FONT,
      fontSize: options.fontSize ?? TERMINAL_FONT_SIZE,
      // Transparent background needs allowTransparency so the window blur shows.
      allowTransparency: true,
      theme: options.theme ?? xtermTheme,
    });

    this.fit = new FitAddon();
    this.term.loadAddon(this.fit);
    this.term.loadAddon(new WebLinksAddon());
    this.term.attachCustomKeyEventHandler((event) => this.handleKey(event));
  }

  /** Attach to the DOM, spawn the shell, and start streaming. */
  async mount(parent: HTMLElement): Promise<void> {
    parent.appendChild(this.element);
    this.term.open(this.viewport);
    // xterm's hidden input triggers macOS spellcheck noise; turn it off.
    this.element.querySelector("textarea")?.setAttribute("spellcheck", "false");
    this.loadRenderer();
    this.fit.fit();

    const { cols, rows } = this.term;

    // Subscribe before spawn so the startup banner and early output are captured.
    this.unlisten = await onPtyOutput(this.sessionId, (bytes) => this.term.write(bytes));
    this.exitUnlisten = await onPtyExit(this.sessionId, () => {
      if (!this.disposed) {
        this.onExit?.();
      }
    });
    await ptySpawn({
      sessionId: this.sessionId,
      shell: this.options.shell,
      cwd: this.options.cwd,
      cols,
      rows,
    });

    this.term.onData((data) => {
      void ptyWrite(this.sessionId, data);
    });
    this.term.onResize(({ cols: c, rows: r }) => {
      void ptyResize(this.sessionId, c, r);
    });

    this.resizeObserver = new ResizeObserver(() => this.refit());
    this.resizeObserver.observe(this.element);
  }

  focus(): void {
    this.term.focus();
  }

  /** Set the pane's label and notify the owner (for session snapshots). */
  setName(name: string): void {
    this.name = name;
    this.renderNameChip();
    this.onRename?.();
  }

  private renderNameChip(): void {
    this.nameChip.textContent = this.name || "＋";
    this.nameChip.classList.toggle("pane__name--empty", !this.name);
  }

  /** Turn the chip into an inline text field to (re)label the pane. */
  private beginRename(): void {
    const input = document.createElement("input");
    input.type = "text";
    input.className = "pane__name-input";
    input.value = this.name;
    input.placeholder = "name…";

    let settled = false;
    const settle = (save: boolean): void => {
      if (settled) {
        return;
      }
      settled = true;
      if (save) {
        this.setName(input.value.trim());
      } else {
        this.renderNameChip();
      }
      this.focus();
    };

    input.addEventListener("keydown", (event) => {
      // Keep keys off xterm and the global shortcuts while editing.
      event.stopPropagation();
      if (event.key === "Enter") {
        event.preventDefault();
        settle(true);
      } else if (event.key === "Escape") {
        event.preventDefault();
        settle(false);
      }
    });
    input.addEventListener("blur", () => settle(true));

    this.nameChip.replaceChildren(input);
    this.nameChip.classList.remove("pane__name--empty");
    input.focus();
    input.select();
  }

  /**
   * Apply a live style change (font, size, cursor blink, colors) to the running
   * terminal — no respawn, the shell and scrollback are untouched. Used when the
   * active profile changes from Preferences.
   */
  applyStyle(style: PaneStyle): void {
    if (this.disposed) {
      return;
    }
    if (style.fontFamily !== undefined) {
      this.term.options.fontFamily = style.fontFamily;
    }
    if (style.fontSize !== undefined) {
      this.term.options.fontSize = style.fontSize;
    }
    if (style.cursorBlink !== undefined) {
      this.term.options.cursorBlink = style.cursorBlink;
    }
    if (style.theme !== undefined) {
      this.term.options.theme = style.theme;
    }
    this.refit();
  }

  /** Clear the terminal, leaving the current prompt at the top (⌘K). */
  clear(): void {
    this.term.clear();
  }

  /** Recompute cols/rows from the pane's pixel size (layout or window change). */
  refit(): void {
    if (this.disposed) {
      return;
    }
    try {
      this.fit.fit();
    } catch {
      // The pane may be momentarily detached during a layout change.
    }
  }

  async dispose(): Promise<void> {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.resizeObserver?.disconnect();
    this.unlisten?.();
    // Unsubscribe from exit before killing, so our own kill doesn't re-trigger it.
    this.exitUnlisten?.();
    await ptyKill(this.sessionId).catch(() => undefined);
    this.term.dispose();
    this.element.remove();
  }

  /** WebGL renderer with a canvas fallback, then xterm's DOM renderer (spec §2). */
  private loadRenderer(): void {
    try {
      const webgl = new WebglAddon();
      webgl.onContextLoss(() => webgl.dispose());
      this.term.loadAddon(webgl);
      return;
    } catch (error) {
      console.warn("WebGL renderer unavailable, trying canvas", error);
    }
    try {
      this.term.loadAddon(new CanvasAddon());
    } catch (error) {
      console.warn("Canvas renderer unavailable, using DOM renderer", error);
    }
  }

  /**
   * macOS clipboard semantics: ⌘C copies the selection (not SIGINT — that stays
   * on Ctrl+C), ⌘V pastes. Copy-on-selection is off. Returning false stops the
   * key from reaching the PTY.
   */
  private handleKey(event: KeyboardEvent): boolean {
    if (event.type !== "keydown" || !event.metaKey) {
      return true;
    }
    const key = event.key.toLowerCase();
    if (key === "c" && this.term.hasSelection()) {
      void navigator.clipboard.writeText(this.term.getSelection()).catch(() => undefined);
      return false;
    }
    if (key === "v") {
      // Block xterm from processing the keydown; the browser fires a separate
      // `paste` event that xterm handles natively via onData → ptyWrite.
      // Calling readText() here would trigger macOS's clipboard permission UI,
      // causing a double-paste when the user clicks "Paste" on the system popup.
      return false;
    }
    return true;
  }
}
