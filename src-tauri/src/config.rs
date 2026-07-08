//! TOML configuration (spec §Config). Lives at
//! `~/Library/Application Support/com.miciodev.terminal/config.toml`.
//!
//! Every field has a default matching the visual spec, so the app works with
//! zero config. A partial file overrides only the keys it sets (serde defaults
//! fill the rest) — that is the merge.

use std::path::Path;

use serde::{Deserialize, Serialize};

/// Terminal colors. Defaults are the §4 palette; a `[palette]` table overrides
/// individual entries.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct Palette {
    pub foreground: String,
    pub cursor: String,
    pub selection: String,
    pub black: String,
    pub red: String,
    pub green: String,
    pub yellow: String,
    pub blue: String,
    pub magenta: String,
    pub cyan: String,
    pub white: String,
    pub bright_black: String,
    pub bright_red: String,
    pub bright_green: String,
    pub bright_yellow: String,
    pub bright_blue: String,
    pub bright_magenta: String,
    pub bright_cyan: String,
    pub bright_white: String,
}

impl Default for Palette {
    fn default() -> Self {
        Self {
            foreground: "#2fff5a".into(),
            cursor: "#2fff5a".into(),
            selection: "rgba(47, 255, 90, 0.30)".into(),
            black: "#15161b".into(),
            red: "#ff5c57".into(),
            green: "#2fff5a".into(),
            yellow: "#f3f99d".into(),
            blue: "#57c7ff".into(),
            magenta: "#ff6ac1".into(),
            cyan: "#9aedfe".into(),
            white: "#e6e6e6".into(),
            bright_black: "#6b7089".into(),
            bright_red: "#ff6e67".into(),
            bright_green: "#5aff78".into(),
            bright_yellow: "#f4f99d".into(),
            bright_blue: "#7fb5ff".into(),
            bright_magenta: "#ff8ad0".into(),
            bright_cyan: "#b3f7ff".into(),
            bright_white: "#ffffff".into(),
        }
    }
}

/// The full app configuration.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct Config {
    /// Background tint opacity, 0.0–1.0 (the OS blur shows through the rest).
    pub opacity: f32,
    /// macOS blur material: "hud" or "under-window".
    pub blur_material: String,
    pub font_family: String,
    pub font_size: f32,
    pub cursor_blink: bool,
    pub watermark: bool,
    pub show_banner: bool,
    /// Login shell; `None` uses `$SHELL`, falling back to `/bin/zsh`.
    pub default_shell: Option<String>,
    pub scrollback: u32,
    #[serde(default)]
    pub palette: Palette,
}

impl Default for Config {
    fn default() -> Self {
        Self {
            opacity: 0.82,
            blur_material: "hud".into(),
            font_family: "JetBrains Mono".into(),
            font_size: 14.0,
            cursor_blink: true,
            watermark: true,
            show_banner: true,
            default_shell: None,
            scrollback: 10_000,
            palette: Palette::default(),
        }
    }
}

/// Parse a TOML config, filling unset keys with defaults and clamping opacity.
pub fn parse(input: &str) -> Result<Config, toml::de::Error> {
    let mut config: Config = toml::from_str(input)?;
    config.opacity = config.opacity.clamp(0.0, 1.0);
    Ok(config)
}

/// Load config from `path`. A missing file yields zero-config defaults; an
/// invalid file is logged and also falls back to defaults so it never bricks
/// the terminal.
pub fn load(path: &Path) -> Config {
    let Ok(text) = std::fs::read_to_string(path) else {
        return Config::default();
    };
    parse(&text).unwrap_or_else(|err| {
        log::warn!("invalid config at {}: {err}", path.display());
        Config::default()
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn defaults_match_the_visual_spec() {
        let config = Config::default();
        assert_eq!(config.opacity, 0.82);
        assert_eq!(config.scrollback, 10_000);
        assert!(config.show_banner);
        assert!(config.watermark);
        assert!(config.cursor_blink);
        assert_eq!(config.font_family, "JetBrains Mono");
        assert_eq!(config.palette.foreground, "#2fff5a");
        assert_eq!(config.default_shell, None);
    }

    #[test]
    fn empty_config_is_all_defaults() {
        assert_eq!(parse("").unwrap(), Config::default());
    }

    #[test]
    fn partial_config_overrides_only_the_given_keys() {
        let config = parse("show_banner = false\nscrollback = 5000\n").unwrap();
        assert!(!config.show_banner);
        assert_eq!(config.scrollback, 5000);
        // Untouched keys keep their defaults.
        assert_eq!(config.opacity, 0.82);
        assert_eq!(config.font_family, "JetBrains Mono");
    }

    #[test]
    fn opacity_is_clamped_to_unit_range() {
        assert_eq!(parse("opacity = 1.5").unwrap().opacity, 1.0);
        assert_eq!(parse("opacity = -0.4").unwrap().opacity, 0.0);
    }

    #[test]
    fn palette_overrides_merge_over_defaults() {
        let config = parse("[palette]\ngreen = \"#00ff00\"\n").unwrap();
        assert_eq!(config.palette.green, "#00ff00");
        // Other palette entries stay at their defaults.
        assert_eq!(config.palette.red, "#ff5c57");
        assert_eq!(config.palette.foreground, "#2fff5a");
    }

    #[test]
    fn invalid_toml_is_an_error() {
        assert!(parse("opacity = = 3").is_err());
    }

    #[test]
    fn load_missing_file_yields_defaults() {
        let config = load(Path::new("/nonexistent/miciodev/config.toml"));
        assert_eq!(config, Config::default());
    }
}
