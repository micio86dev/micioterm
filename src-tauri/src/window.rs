//! macOS window appearance: real behind-window blur via `NSVisualEffectView`.
//!
//! The window is configured `transparent: true` + `macOSPrivateApi: true` in
//! tauri.conf.json; here we attach the vibrancy layer the transparent webview
//! lets through. The 82%-black tint that darkens the blur lives in CSS.

use tauri::{App, Manager};

use crate::config::Config;

/// Attach the behind-window blur to the main window. No-op off macOS.
pub fn apply_window_effects(app: &App, config: &Config) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };

    #[cfg(target_os = "macos")]
    {
        use window_vibrancy::{apply_vibrancy, NSVisualEffectMaterial, NSVisualEffectState};

        let material = match config.blur_material.as_str() {
            "under-window" => NSVisualEffectMaterial::UnderWindowBackground,
            _ => NSVisualEffectMaterial::HudWindow,
        };

        if let Err(err) = apply_vibrancy(
            &window,
            material,
            Some(NSVisualEffectState::Active),
            None,
        ) {
            log::warn!("failed to apply window vibrancy: {err}");
        }
    }

    #[cfg(not(target_os = "macos"))]
    let _ = (window, config);
}
