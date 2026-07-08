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
  scrollback?: number;
  fontFamily?: string;
  fontSize?: number;
  cursorBlink?: boolean;
  theme?: ITheme;
}

/**
 * One terminal pane: an xterm.js instance bound to exactly one backend PTY.
 * Keystrokes flow out via `pty_write`; shell output flows in on the pane's
 * `pty://output/<id>` event. The frontend never parses escape sequences.
 */
export class Pane {
  readonly sessionId: string;
  readonly element: HTMLDivElement;

  /** Called when the pane's shell exits (e.g. Ctrl+D). Set by the owner. */
  onExit?: () => void;

  private readonly term: Terminal;
  private readonly fit: FitAddon;
  private readonly options: PaneOptions;
  private unlisten?: UnlistenFn;
  private exitUnlisten?: UnlistenFn;
  private resizeObserver?: ResizeObserver;
  private disposed = false;

  constructor(options: PaneOptions = {}) {
    this.options = options;
    this.sessionId = newSessionId();

    this.element = document.createElement("div");
    this.element.className = "pane";

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
    this.term.open(this.element);
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
      void navigator.clipboard
        .readText()
        .then((text) => ptyWrite(this.sessionId, text))
        .catch(() => undefined);
      return false;
    }
    return true;
  }
}
