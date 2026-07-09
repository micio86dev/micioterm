import { describe, expect, it } from "vitest";

import type { PaletteConfig } from "../config/config";
import { themeFromPalette, xtermTheme } from "./xterm-theme";

const palette: PaletteConfig = {
  foreground: "#111111",
  cursor: "#222222",
  selection: "rgba(1, 2, 3, 0.4)",
  black: "#000000",
  red: "#ff0000",
  green: "#00ff00",
  yellow: "#ffff00",
  blue: "#0000ff",
  magenta: "#ff00ff",
  cyan: "#00ffff",
  white: "#eeeeee",
  bright_black: "#101010",
  bright_red: "#ff1010",
  bright_green: "#10ff10",
  bright_yellow: "#ffff10",
  bright_blue: "#1010ff",
  bright_magenta: "#ff10ff",
  bright_cyan: "#10ffff",
  bright_white: "#ffffff",
};

describe("themeFromPalette", () => {
  it("maps snake_case palette keys to the xterm camelCase theme", () => {
    const theme = themeFromPalette(palette);
    expect(theme.foreground).toBe("#111111");
    expect(theme.cursor).toBe("#222222");
    expect(theme.selectionBackground).toBe("rgba(1, 2, 3, 0.4)");
    expect(theme.brightBlack).toBe("#101010");
    expect(theme.brightWhite).toBe("#ffffff");
    expect(theme.red).toBe("#ff0000");
  });

  it("keeps the background transparent so the window blur shows through", () => {
    expect(themeFromPalette(palette).background).toBe("rgba(0, 0, 0, 0)");
    expect(xtermTheme.background).toBe("rgba(0, 0, 0, 0)");
  });
});
