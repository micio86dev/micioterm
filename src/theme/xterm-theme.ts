import type { ITheme } from "@xterm/xterm";

import type { PaletteConfig } from "../config/config";

/** Terminal font stack — bundled JetBrains Mono first, system mono fallbacks. */
export const TERMINAL_FONT = '"JetBrains Mono", "SFMono-Regular", Menlo, ui-monospace, monospace';
export const TERMINAL_FONT_SIZE = 14;

/**
 * xterm theme (spec §4): transparent background so the window blur shows through
 * (paired with `allowTransparency`), neon-green foreground and block cursor, and
 * a full 16-color ANSI palette that stays readable on the dark translucent bg.
 */
export const xtermTheme: ITheme = {
  background: "rgba(0, 0, 0, 0)",
  foreground: "#2fff5a",
  cursor: "#2fff5a",
  cursorAccent: "#000000",
  selectionBackground: "rgba(47, 255, 90, 0.30)",

  black: "#15161b",
  red: "#ff5c57",
  green: "#2fff5a",
  yellow: "#f3f99d",
  blue: "#57c7ff",
  magenta: "#ff6ac1",
  cyan: "#9aedfe",
  white: "#e6e6e6",

  brightBlack: "#6b7089",
  brightRed: "#ff6e67",
  brightGreen: "#5aff78",
  brightYellow: "#f4f99d",
  brightBlue: "#7fb5ff",
  brightMagenta: "#ff8ad0",
  brightCyan: "#b3f7ff",
  brightWhite: "#ffffff",
};

/** Build an xterm theme from a config palette (background stays transparent). */
export function themeFromPalette(palette: PaletteConfig): ITheme {
  return {
    background: "rgba(0, 0, 0, 0)",
    cursorAccent: "#000000",
    foreground: palette.foreground,
    cursor: palette.cursor,
    selectionBackground: palette.selection,
    black: palette.black,
    red: palette.red,
    green: palette.green,
    yellow: palette.yellow,
    blue: palette.blue,
    magenta: palette.magenta,
    cyan: palette.cyan,
    white: palette.white,
    brightBlack: palette.bright_black,
    brightRed: palette.bright_red,
    brightGreen: palette.bright_green,
    brightYellow: palette.bright_yellow,
    brightBlue: palette.bright_blue,
    brightMagenta: palette.bright_magenta,
    brightCyan: palette.bright_cyan,
    brightWhite: palette.bright_white,
  };
}
