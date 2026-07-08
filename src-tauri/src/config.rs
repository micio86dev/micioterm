//! TOML configuration (spec §Config). Lives at
//! `~/Library/Application Support/com.miciodev.terminal/config.toml`.
//!
//! The file holds a list of named style [`Profile`]s plus the id of the one
//! that is currently active; the active profile drives the whole app (font,
//! colors, opacity, blur). Non-visual settings (scrollback, shell, banner)
//! stay global on [`Config`].
//!
//! Every field has a default matching the visual spec, so the app works with
//! zero config. Older, pre-profiles files (flat `opacity`/`font_size`/`[palette]`
//! keys) are migrated on load into a single "Default" profile — see [`parse`].

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

/// A named style profile: everything that defines the *look* of the terminal.
///
/// Field order matters: scalar keys come before the `palette` table so
/// `toml::to_string` can serialize a profile (TOML requires values before
/// nested tables).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct Profile {
    /// Stable id, referenced by [`Config::active_profile_id`].
    pub id: String,
    /// Human-facing name shown in the Preferences profile list.
    pub name: String,
    /// Background tint opacity, 0.0–1.0 (the OS blur shows through the rest).
    pub opacity: f32,
    /// macOS blur material: "hud" or "under-window".
    pub blur_material: String,
    pub font_family: String,
    pub font_size: f32,
    pub cursor_blink: bool,
    pub palette: Palette,
}

impl Default for Profile {
    fn default() -> Self {
        Self {
            id: "default".into(),
            name: "Default".into(),
            opacity: 0.82,
            blur_material: "hud".into(),
            font_family: "JetBrains Mono".into(),
            font_size: 14.0,
            cursor_blink: true,
            palette: Palette::default(),
        }
    }
}

/// The full app configuration.
///
/// Invariant: `profiles` is never empty and `active_profile_id` always names a
/// profile in the list (enforced by [`parse`] / [`Config::default`]). Field
/// order keeps the `profiles` array-of-tables last for TOML serialization.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct Config {
    pub active_profile_id: String,
    pub watermark: bool,
    pub show_banner: bool,
    /// Login shell; `None` uses `$SHELL`, falling back to `/bin/zsh`.
    pub default_shell: Option<String>,
    pub scrollback: u32,
    pub profiles: Vec<Profile>,
}

impl Default for Config {
    fn default() -> Self {
        Self {
            active_profile_id: "default".into(),
            watermark: true,
            show_banner: true,
            default_shell: None,
            scrollback: 10_000,
            profiles: vec![Profile::default()],
        }
    }
}

impl Config {
    /// The profile that drives the whole app right now. Falls back to the first
    /// profile if `active_profile_id` is stale (the invariant makes this total).
    pub fn active_profile(&self) -> &Profile {
        self.profiles
            .iter()
            .find(|p| p.id == self.active_profile_id)
            .or_else(|| self.profiles.first())
            .expect("config always has at least one profile")
    }

    /// Re-establish the invariants on a `Config` that crossed an untrusted
    /// boundary (the `save_config` IPC deserializes straight into `Config` and
    /// would happily accept `profiles = []` or a stale active id). Without this,
    /// a bad payload could later panic [`active_profile`] and poison the mutex.
    pub fn sanitized(mut self) -> Config {
        if self.profiles.is_empty() {
            self.profiles.push(Profile::default());
        }
        for profile in &mut self.profiles {
            profile.opacity = profile.opacity.clamp(0.0, 1.0);
        }
        if !self.profiles.iter().any(|p| p.id == self.active_profile_id) {
            self.active_profile_id = self.profiles[0].id.clone();
        }
        self
    }
}

/// Raw on-disk shape. Every key is optional so we can tell "absent" from "set",
/// and so we can accept both the new profile layout and the legacy flat layout
/// in the same pass. Normalized into a [`Config`] by [`normalize`].
#[derive(Debug, Default, Deserialize)]
#[serde(default)]
struct RawConfig {
    // New layout.
    profiles: Option<Vec<Profile>>,
    active_profile_id: Option<String>,
    // Global (non-visual) settings.
    watermark: Option<bool>,
    show_banner: Option<bool>,
    default_shell: Option<String>,
    scrollback: Option<u32>,
    // Legacy flat style keys (pre-profiles files). Migrated into "Default".
    opacity: Option<f32>,
    blur_material: Option<String>,
    font_family: Option<String>,
    font_size: Option<f32>,
    cursor_blink: Option<bool>,
    palette: Option<Palette>,
}

/// Turn the permissive [`RawConfig`] into a valid [`Config`], upholding the
/// non-empty-profiles and valid-active-id invariants and clamping opacity.
fn normalize(raw: RawConfig) -> Config {
    let mut profiles = raw.profiles.unwrap_or_default();

    // No explicit profiles → synthesize one "Default", absorbing any legacy
    // flat style keys so old configs keep their look.
    if profiles.is_empty() {
        let base = Profile::default();
        profiles.push(Profile {
            id: base.id,
            name: base.name,
            opacity: raw.opacity.unwrap_or(base.opacity),
            blur_material: raw.blur_material.unwrap_or(base.blur_material),
            font_family: raw.font_family.unwrap_or(base.font_family),
            font_size: raw.font_size.unwrap_or(base.font_size),
            cursor_blink: raw.cursor_blink.unwrap_or(base.cursor_blink),
            palette: raw.palette.unwrap_or_default(),
        });
    }

    for profile in &mut profiles {
        profile.opacity = profile.opacity.clamp(0.0, 1.0);
    }

    // Keep the requested active id only if it names a real profile.
    let active_profile_id = raw
        .active_profile_id
        .filter(|id| profiles.iter().any(|p| &p.id == id))
        .unwrap_or_else(|| profiles[0].id.clone());

    Config {
        active_profile_id,
        watermark: raw.watermark.unwrap_or(true),
        show_banner: raw.show_banner.unwrap_or(true),
        default_shell: raw.default_shell,
        scrollback: raw.scrollback.unwrap_or(10_000),
        profiles,
    }
}

/// Parse a TOML config, filling unset keys with defaults, migrating legacy flat
/// files, and clamping each profile's opacity.
pub fn parse(input: &str) -> Result<Config, toml::de::Error> {
    let raw: RawConfig = toml::from_str(input)?;
    Ok(normalize(raw))
}

/// Serialize a config back to TOML for persistence (see the `save_config`
/// command). The inverse of [`parse`] for round-tripping.
pub fn to_toml(config: &Config) -> Result<String, toml::ser::Error> {
    toml::to_string_pretty(config)
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
    fn default_config_has_a_single_default_profile() {
        let config = Config::default();
        assert_eq!(config.profiles.len(), 1);
        assert_eq!(config.active_profile_id, "default");
        let profile = config.active_profile();
        assert_eq!(profile.id, "default");
        assert_eq!(profile.name, "Default");
        assert_eq!(profile.opacity, 0.82);
        assert_eq!(profile.font_family, "JetBrains Mono");
        assert_eq!(profile.palette.foreground, "#2fff5a");
    }

    #[test]
    fn default_globals_match_the_visual_spec() {
        let config = Config::default();
        assert_eq!(config.scrollback, 10_000);
        assert!(config.show_banner);
        assert!(config.watermark);
        assert_eq!(config.default_shell, None);
    }

    #[test]
    fn empty_config_is_all_defaults() {
        assert_eq!(parse("").unwrap(), Config::default());
    }

    #[test]
    fn legacy_flat_config_migrates_into_the_default_profile() {
        let config = parse("opacity = 0.9\nfont_size = 16.0\n[palette]\ngreen = \"#00ff00\"\n")
            .unwrap();
        assert_eq!(config.profiles.len(), 1);
        let profile = config.active_profile();
        assert_eq!(profile.id, "default");
        assert_eq!(profile.opacity, 0.9);
        assert_eq!(profile.font_size, 16.0);
        assert_eq!(profile.palette.green, "#00ff00");
        // Untouched style keys keep their defaults.
        assert_eq!(profile.font_family, "JetBrains Mono");
        assert_eq!(profile.palette.red, "#ff5c57");
    }

    #[test]
    fn legacy_global_keys_still_apply() {
        let config = parse("show_banner = false\nscrollback = 5000\n").unwrap();
        assert!(!config.show_banner);
        assert_eq!(config.scrollback, 5000);
        // And a Default profile is still synthesized.
        assert_eq!(config.profiles.len(), 1);
        assert_eq!(config.active_profile().opacity, 0.82);
    }

    #[test]
    fn explicit_profiles_are_used_verbatim() {
        let input = r#"
active_profile_id = "night"

[[profiles]]
id = "day"
name = "Day"
font_size = 13.0

[[profiles]]
id = "night"
name = "Night"
opacity = 0.5
"#;
        let config = parse(input).unwrap();
        assert_eq!(config.profiles.len(), 2);
        assert_eq!(config.active_profile_id, "night");
        assert_eq!(config.active_profile().name, "Night");
        assert_eq!(config.active_profile().opacity, 0.5);
        // Unset profile keys fall back to per-profile defaults.
        assert_eq!(config.profiles[0].font_size, 13.0);
        assert_eq!(config.profiles[0].font_family, "JetBrains Mono");
    }

    #[test]
    fn active_profile_id_falls_back_to_first_when_stale() {
        let input = r#"
active_profile_id = "ghost"

[[profiles]]
id = "day"
name = "Day"
"#;
        let config = parse(input).unwrap();
        assert_eq!(config.active_profile_id, "day");
        assert_eq!(config.active_profile().id, "day");
    }

    #[test]
    fn per_profile_opacity_is_clamped_to_unit_range() {
        let input = r#"
[[profiles]]
id = "a"
name = "A"
opacity = 1.5

[[profiles]]
id = "b"
name = "B"
opacity = -0.4
"#;
        let config = parse(input).unwrap();
        assert_eq!(config.profiles[0].opacity, 1.0);
        assert_eq!(config.profiles[1].opacity, 0.0);
    }

    #[test]
    fn legacy_opacity_is_clamped_during_migration() {
        assert_eq!(parse("opacity = 1.5").unwrap().active_profile().opacity, 1.0);
        assert_eq!(parse("opacity = -0.4").unwrap().active_profile().opacity, 0.0);
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

    #[test]
    fn explicitly_empty_profiles_array_still_yields_one_default() {
        let config = parse("profiles = []").unwrap();
        assert_eq!(config.profiles.len(), 1);
        assert_eq!(config.active_profile().id, "default");
    }

    #[test]
    fn sanitized_replaces_an_empty_profile_list() {
        let broken = Config {
            active_profile_id: "ghost".into(),
            profiles: vec![],
            ..Config::default()
        };
        let fixed = broken.sanitized();
        assert_eq!(fixed.profiles.len(), 1);
        // active id was stale AND the list was empty → falls back to the survivor.
        assert_eq!(fixed.active_profile_id, fixed.profiles[0].id);
        // active_profile must not panic after sanitizing.
        assert_eq!(fixed.active_profile().id, fixed.profiles[0].id);
    }

    #[test]
    fn sanitized_fixes_a_stale_active_id_and_clamps_opacity() {
        let broken = Config {
            active_profile_id: "nope".into(),
            profiles: vec![
                Profile {
                    id: "a".into(),
                    opacity: 5.0,
                    ..Profile::default()
                },
            ],
            ..Config::default()
        };
        let fixed = broken.sanitized();
        assert_eq!(fixed.active_profile_id, "a");
        assert_eq!(fixed.profiles[0].opacity, 1.0);
    }

    #[test]
    fn config_round_trips_through_toml() {
        let mut original = Config::default();
        original.profiles.push(Profile {
            id: "night".into(),
            name: "Night".into(),
            opacity: 0.5,
            blur_material: "under-window".into(),
            font_family: "Fira Code".into(),
            font_size: 15.0,
            cursor_blink: false,
            palette: Palette::default(),
        });
        original.active_profile_id = "night".into();
        original.default_shell = Some("/bin/fish".into());

        let serialized = to_toml(&original).expect("serialize");
        let parsed = parse(&serialized).expect("parse round-trip");
        assert_eq!(parsed, original);
    }
}
