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

/**
 * A named style profile mirrored from the Rust `Profile` (snake_case keys).
 * Everything that defines the terminal's *look* lives here.
 */
export interface ProfileConfig {
  id: string;
  name: string;
  opacity: number;
  blur_material: string;
  font_family: string;
  font_size: number;
  cursor_blink: boolean;
  palette: PaletteConfig;
}

/**
 * App configuration mirrored from the Rust `Config` (snake_case keys). Holds
 * the list of style profiles plus the id of the active one; non-visual settings
 * stay global.
 */
export interface TerminalConfig {
  active_profile_id: string;
  watermark: boolean;
  show_banner: boolean;
  default_shell: string | null;
  scrollback: number;
  profiles: ProfileConfig[];
}

/**
 * The profile driving the whole app right now. Mirrors Rust's
 * `Config::active_profile`: prefer the active id, fall back to the first
 * profile (the backend guarantees the list is never empty).
 */
export function activeProfile(config: TerminalConfig): ProfileConfig {
  return (
    config.profiles.find((p) => p.id === config.active_profile_id) ?? config.profiles[0]
  );
}

/** Fetch the current config from the backend (already merged with defaults). */
export function loadConfig(): Promise<TerminalConfig> {
  return invoke<TerminalConfig>("get_config");
}

/** Persist a config to disk and swap the backend's in-memory copy. */
export function saveConfig(config: TerminalConfig): Promise<void> {
  return invoke("save_config", { newConfig: config });
}

/** Change the current window's blur material live ("hud" | "under-window"). */
export function setBlurMaterial(material: string): Promise<void> {
  return invoke("set_blur_material", { material });
}
