//! Tauri command layer: thin glue between the WKWebView frontend and the PTY
//! [`SessionManager`]. Output bytes are base64-encoded and streamed to the
//! frontend on the per-session event `pty://output/<session_id>`.

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;

use base64::Engine;
use tauri::{AppHandle, Emitter, Manager, State, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

use crate::config::Config;
use crate::pty::manager::SessionManager;
use crate::pty::session::PtyConfig;

/// Monotonic counter for unique window labels.
static WINDOW_COUNTER: AtomicU64 = AtomicU64::new(0);

/// Monotonic counter so concurrent writers never share a temp-file path.
static WRITE_COUNTER: AtomicU64 = AtomicU64::new(0);

/// Write `contents` to `dir/filename` atomically: a per-call unique temp file
/// (so two concurrent writers can't corrupt each other's temp) plus a rename,
/// which is the only writer of the final path.
fn atomic_write(dir: &std::path::Path, filename: &str, contents: &str) -> Result<(), String> {
    std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let seq = WRITE_COUNTER.fetch_add(1, Ordering::Relaxed);
    let tmp = dir.join(format!("{filename}.{seq}.tmp"));
    let final_path = dir.join(filename);
    std::fs::write(&tmp, contents).map_err(|e| e.to_string())?;
    if let Err(err) = std::fs::rename(&tmp, &final_path) {
        let _ = std::fs::remove_file(&tmp);
        return Err(err.to_string());
    }
    Ok(())
}

/// Open a new terminal window (⌘N). Each window is independent, with its own
/// tabs and panes; handy for spanning multiple monitors.
#[tauri::command]
pub fn open_window(app: AppHandle, config: State<'_, Mutex<Config>>) -> Result<(), String> {
    let label = format!("win-{}", WINDOW_COUNTER.fetch_add(1, Ordering::Relaxed));
    let window = WebviewWindowBuilder::new(&app, &label, WebviewUrl::App("index.html".into()))
        .title("MicioTerm")
        .inner_size(1024.0, 700.0)
        .min_inner_size(480.0, 320.0)
        .transparent(true)
        .build()
        .map_err(|e| e.to_string())?;
    let config = config.lock().expect("config mutex poisoned").clone();
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

/// Return the current configuration to the frontend.
#[tauri::command]
pub fn get_config(config: State<'_, Mutex<Config>>) -> Config {
    config.lock().expect("config mutex poisoned").clone()
}

/// Persist a new configuration from the Preferences UI: write it back to
/// `config.toml` atomically (temp file + rename), then swap the shared
/// in-memory copy so new windows/panes pick it up.
#[tauri::command]
pub fn save_config(
    app: AppHandle,
    config: State<'_, Mutex<Config>>,
    new_config: Config,
) -> Result<(), String> {
    // Never trust the IPC payload: re-establish the invariants so a malformed
    // config can't later panic `active_profile()` and poison the mutex.
    let new_config = new_config.sanitized();

    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    let serialized = crate::config::to_toml(&new_config).map_err(|e| e.to_string())?;
    atomic_write(&dir, "config.toml", &serialized)?;

    *config.lock().expect("config mutex poisoned") = new_config;
    Ok(())
}

/// Change the calling window's blur material live (Preferences → background).
#[tauri::command]
pub fn set_blur_material(window: WebviewWindow, material: String) {
    crate::window::apply_material(&window, &material);
}

/// Spawn a shell for a pane. The frontend generates `session_id`, subscribes to
/// `pty://output/<session_id>`, then calls this — so no early output is lost.
#[tauri::command]
pub fn pty_spawn(
    app: AppHandle,
    sessions: State<'_, SessionManager>,
    config: State<'_, Mutex<Config>>,
    session_id: String,
    shell: Option<String>,
    args: Option<Vec<String>>,
    cwd: Option<String>,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    // Snapshot the two config values we need, then drop the lock before spawning.
    let (config_shell, show_banner) = {
        let config = config.lock().expect("config mutex poisoned");
        (config.default_shell.clone(), config.show_banner)
    };
    // Shell precedence: explicit arg → config default_shell → $SHELL → /bin/zsh.
    let shell = shell.or(config_shell).unwrap_or_else(default_shell);
    // Default to a login shell so macOS GUI launches pick up the user's PATH.
    let args = args.unwrap_or_else(|| vec!["-l".to_string()]);
    let event = output_event(&session_id);

    // Emit the startup banner first, before the shell can print its prompt. The
    // frontend subscribed before calling this, so the ordering is guaranteed.
    let banner = crate::banner::banner_bytes(show_banner);
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

/// A pane's shell working directory, for session restore. `None` if unknown.
#[tauri::command]
pub fn pty_cwd(state: State<'_, SessionManager>, session_id: String) -> Option<String> {
    state.cwd(&session_id)
}

/// Persist the frontend's session snapshot JSON (tabs/panes/cwd/names) to disk.
/// Written atomically so it survives an abrupt ⌘Q — unlike WebKit localStorage,
/// which may not flush before the app is terminated.
#[tauri::command]
pub fn save_session(app: AppHandle, snapshot: String) -> Result<(), String> {
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    atomic_write(&dir, "session.json", &snapshot)
}

/// Load the persisted session snapshot JSON, if any.
#[tauri::command]
pub fn load_session(app: AppHandle) -> Option<String> {
    let dir = app.path().app_config_dir().ok()?;
    std::fs::read_to_string(dir.join("session.json")).ok()
}
