pub mod banner;
pub mod commands;
pub mod config;
pub mod pty;
pub mod window;

use tauri::Manager;

use pty::manager::SessionManager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .manage(SessionManager::new())
    .invoke_handler(tauri::generate_handler![
      commands::get_config,
      commands::pty_spawn,
      commands::pty_write,
      commands::pty_resize,
      commands::pty_kill,
    ])
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }

      // Load config once at startup (missing/invalid → defaults) and share it.
      let config = app
        .path()
        .app_config_dir()
        .map(|dir| config::load(&dir.join("config.toml")))
        .unwrap_or_default();
      window::apply_window_effects(app, &config);
      app.manage(config);

      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
