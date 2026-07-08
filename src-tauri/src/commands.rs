//! Tauri command layer: thin glue between the WKWebView frontend and the PTY
//! [`SessionManager`]. Output bytes are base64-encoded and streamed to the
//! frontend on the per-session event `pty://output/<session_id>`.

use std::sync::atomic::{AtomicU64, Ordering};

use base64::Engine;
use tauri::{AppHandle, Emitter, State, WebviewUrl, WebviewWindowBuilder};

use crate::config::Config;
use crate::pty::manager::SessionManager;
use crate::pty::session::PtyConfig;

/// Monotonic counter for unique window labels.
static WINDOW_COUNTER: AtomicU64 = AtomicU64::new(0);

/// Open a new terminal window (⌘N). Each window is independent, with its own
/// tabs and panes; handy for spanning multiple monitors.
#[tauri::command]
pub fn open_window(app: AppHandle, config: State<'_, Config>) -> Result<(), String> {
    let label = format!("win-{}", WINDOW_COUNTER.fetch_add(1, Ordering::Relaxed));
    let window = WebviewWindowBuilder::new(&app, &label, WebviewUrl::App("index.html".into()))
        .title("MicioTerm")
        .inner_size(1024.0, 700.0)
        .min_inner_size(480.0, 320.0)
        .transparent(true)
        .build()
        .map_err(|e| e.to_string())?;
    crate::window::apply_vibrancy_to(&window, &config);
    Ok(())
}

/// Event name a pane listens on for its shell output.
fn output_event(session_id: &str) -> String {
    format!("pty://output/{session_id}")
}

/// The user's login shell, falling back to zsh (spec §Tabs).
fn default_shell() -> String {
    std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string())
}

/// Return the loaded configuration to the frontend.
#[tauri::command]
pub fn get_config(config: State<'_, Config>) -> Config {
    config.inner().clone()
}

/// Spawn a shell for a pane. The frontend generates `session_id`, subscribes to
/// `pty://output/<session_id>`, then calls this — so no early output is lost.
#[tauri::command]
pub fn pty_spawn(
    app: AppHandle,
    sessions: State<'_, SessionManager>,
    config: State<'_, Config>,
    session_id: String,
    shell: Option<String>,
    args: Option<Vec<String>>,
    cwd: Option<String>,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    // Shell precedence: explicit arg → config default_shell → $SHELL → /bin/zsh.
    let shell = shell
        .or_else(|| config.default_shell.clone())
        .unwrap_or_else(default_shell);
    // Default to a login shell so macOS GUI launches pick up the user's PATH.
    let args = args.unwrap_or_else(|| vec!["-l".to_string()]);
    let event = output_event(&session_id);

    // Emit the startup banner first, before the shell can print its prompt. The
    // frontend subscribed before calling this, so the ordering is guaranteed.
    let banner = crate::banner::banner_bytes(config.show_banner);
    if !banner.is_empty() {
        let encoded = base64::engine::general_purpose::STANDARD.encode(&banner);
        let _ = app.emit(&event, encoded);
    }

    let output_app = app.clone();
    let output_event_name = event.clone();
    let exit_app = app.clone();
    let exit_event_name = format!("pty://exit/{session_id}");
    sessions
        .spawn(
            session_id,
            PtyConfig {
                shell,
                args,
                cwd,
                cols,
                rows,
            },
            move |bytes| {
                let encoded = base64::engine::general_purpose::STANDARD.encode(&bytes);
                let _ = output_app.emit(&output_event_name, encoded);
            },
            move || {
                let _ = exit_app.emit(&exit_event_name, ());
            },
        )
        .map_err(|e| e.to_string())
}

/// Forward keystrokes / pasted text to a pane's shell.
#[tauri::command]
pub fn pty_write(
    state: State<'_, SessionManager>,
    session_id: String,
    data: String,
) -> Result<(), String> {
    state
        .write(&session_id, data.as_bytes())
        .map_err(|e| e.to_string())
}

/// Resize a pane's PTY (cols/rows come from xterm's FitAddon).
#[tauri::command]
pub fn pty_resize(
    state: State<'_, SessionManager>,
    session_id: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    state
        .resize(&session_id, cols, rows)
        .map_err(|e| e.to_string())
}

/// Kill a pane's shell and drop its session.
#[tauri::command]
pub fn pty_kill(state: State<'_, SessionManager>, session_id: String) -> Result<(), String> {
    state.kill(&session_id).map_err(|e| e.to_string())
}
