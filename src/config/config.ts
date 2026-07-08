import { invoke } from "@tauri-apps/api/core";

/** Terminal palette (snake_case to match the Rust config / TOML keys). */
export interface PaletteConfig {
  foreground: string;
  cursor: string;
  selection: string;
  black: string;
  red: string;
  green: string;
  yellow: string;
  blue: string;
  magenta: string;
  cyan: string;
  white: string;
  bright_black: string;
  bright_red: string;
  bright_green: string;
  bright_yellow: string;
  bright_blue: string;
  bright_magenta: string;
  bright_cyan: string;
  bright_white: string;
}

/** App configuration mirrored from the Rust `Config` (snake_case keys). */
export interface TerminalConfig {
  opacity: number;
  blur_material: string;
  font_family: string;
  font_size: number;
  cursor_blink: boolean;
  watermark: boolean;
  show_banner: boolean;
  default_shell: string | null;
  scrollback: number;
  palette: PaletteConfig;
}

/** Fetch the loaded config from the backend (already merged with defaults). */
export function loadConfig(): Promise<TerminalConfig> {
  return invoke<TerminalConfig>("get_config");
}
