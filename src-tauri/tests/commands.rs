//! Integration tests for the Tauri command layer, driven through tauri::test's
//! MockRuntime. Commands that need a real window (open_window, set_blur_material)
//! or spawn a live PTY (pty_spawn) are exercised by the running app, not here.

use std::sync::Mutex;

use app_lib::commands;
use app_lib::config::Config;
use app_lib::pty::manager::SessionManager;
use tauri::test::{mock_builder, mock_context, noop_assets};
use tauri::Manager;

/// Disk-touching tests share one app_config_dir (fixed by the mock identifier),
/// so serialize them to avoid config.toml / session.json races.
static DISK: Mutex<()> = Mutex::new(());

fn test_app() -> tauri::App<tauri::test::MockRuntime> {
    mock_builder()
        .manage(Mutex::new(Config::default()))
        .manage(SessionManager::new())
        .build(mock_context(noop_assets()))
        .expect("mock app should build")
}

#[test]
fn get_config_returns_the_managed_config() {
    let app = test_app();
    assert_eq!(commands::get_config(app.state::<Mutex<Config>>()), Config::default());
}

#[test]
fn save_config_persists_to_disk_and_swaps_memory() {
    let _guard = DISK.lock().unwrap();
    let app = test_app();
    let handle = app.handle().clone();
    let dir = handle.path().app_config_dir().unwrap();

    let mut custom = Config::default();
    custom.scrollback = 4242;
    commands::save_config(handle.clone(), app.state::<Mutex<Config>>(), custom).unwrap();

    // In-memory copy swapped …
    assert_eq!(commands::get_config(app.state::<Mutex<Config>>()).scrollback, 4242);
    // … and the file re-parses to the same value.
    let text = std::fs::read_to_string(dir.join("config.toml")).unwrap();
    assert_eq!(app_lib::config::parse(&text).unwrap().scrollback, 4242);

    let _ = std::fs::remove_file(dir.join("config.toml"));
}

#[test]
fn save_config_sanitizes_an_invalid_payload() {
    let _guard = DISK.lock().unwrap();
    let app = test_app();
    let handle = app.handle().clone();
    let dir = handle.path().app_config_dir().unwrap();

    // A malformed IPC payload: no profiles, stale active id.
    let broken = Config {
        active_profile_id: "ghost".into(),
        profiles: vec![],
        ..Config::default()
    };
    commands::save_config(handle.clone(), app.state::<Mutex<Config>>(), broken).unwrap();

    let cfg = commands::get_config(app.state::<Mutex<Config>>());
    assert_eq!(cfg.profiles.len(), 1, "empty profiles must be sanitized to a default");
    assert_eq!(cfg.active_profile().id, cfg.profiles[0].id);

    let _ = std::fs::remove_file(dir.join("config.toml"));
}

#[test]
fn session_round_trips_through_disk() {
    let _guard = DISK.lock().unwrap();
    let app = test_app();
    let handle = app.handle().clone();
    let dir = handle.path().app_config_dir().unwrap();

    let json = r#"{"version":1,"activeTabIndex":0,"tabs":[]}"#;
    commands::save_session(handle.clone(), json.to_string()).unwrap();
    assert_eq!(commands::load_session(handle.clone()).as_deref(), Some(json));

    let _ = std::fs::remove_file(dir.join("session.json"));
}

#[test]
fn load_session_is_none_when_absent() {
    let _guard = DISK.lock().unwrap();
    let app = test_app();
    let handle = app.handle().clone();
    let dir = handle.path().app_config_dir().unwrap();
    let _ = std::fs::remove_file(dir.join("session.json"));

    assert_eq!(commands::load_session(handle.clone()), None);
}

#[test]
fn pty_cwd_of_unknown_session_is_none() {
    let app = test_app();
    assert_eq!(commands::pty_cwd(app.state::<SessionManager>(), "ghost".into()), None);
}

#[test]
fn pty_write_resize_kill_reject_unknown_sessions() {
    let app = test_app();
    let sessions = app.state::<SessionManager>();
    assert!(commands::pty_write(sessions.clone(), "ghost".into(), "x".into()).is_err());
    assert!(commands::pty_resize(sessions.clone(), "ghost".into(), 80, 24).is_err());
    assert!(commands::pty_kill(sessions.clone(), "ghost".into()).is_err());
}
