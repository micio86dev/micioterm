//! macOS window appearance: real behind-window blur via `NSVisualEffectView`.
//!
//! Windows are configured `transparent: true` + `macOSPrivateApi: true`; here we
//! attach the vibrancy layer the transparent webview lets through. The 82%-black
//! tint that darkens the blur lives in CSS.

use tauri::{App, Manager, Runtime, WebviewWindow};

use crate::config::Config;

/// Apply a named blur material ("hud" or "under-window") to a window. No-op off
/// macOS. Re-callable at runtime so the Preferences UI can change it live.
/// Generic over the runtime so it can be driven by tauri::test's MockRuntime.
pub fn apply_material<R: Runtime>(window: &WebviewWindow<R>, material: &str) {
    #[cfg(target_os = "macos")]
    {
        use window_vibrancy::{apply_vibrancy, NSVisualEffectMaterial, NSVisualEffectState};

        let material = match material {
            "under-window" => NSVisualEffectMaterial::UnderWindowBackground,
            _ => NSVisualEffectMaterial::HudWindow,
        };

        if let Err(err) = apply_vibrancy(window, material, Some(NSVisualEffectState::Active), None) {
            log::warn!("failed to apply window vibrancy: {err}");
        }
    }

    #[cfg(not(target_os = "macos"))]
    let _ = (window, material);
}

/// Attach the active profile's behind-window blur to a specific window.
pub fn apply_vibrancy_to<R: Runtime>(window: &WebviewWindow<R>, config: &Config) {
    apply_material(window, &config.active_profile().blur_material);
}

/// Attach the blur to the main window at startup.
pub fn apply_window_effects<R: Runtime>(app: &App<R>, config: &Config) {
    if let Some(window) = app.get_webview_window("main") {
        apply_vibrancy_to(&window, config);
    }
}
