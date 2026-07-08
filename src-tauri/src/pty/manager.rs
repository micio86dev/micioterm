//! Owns every live [`PtySession`], keyed by the frontend-supplied session id.
//!
//! The frontend generates a session id, subscribes to `pty://output/<id>`, then
//! calls `pty_spawn` — so no output is missed. The id is unique per pane and
//! lives as long as the pane does.

use std::collections::HashMap;
use std::sync::{Mutex, MutexGuard};

use super::session::{PtyConfig, PtySession};

/// Registry of active PTY sessions, safe to share as Tauri managed state.
#[derive(Default)]
pub struct SessionManager {
    sessions: Mutex<HashMap<String, PtySession>>,
}

fn not_found(id: &str) -> std::io::Error {
    std::io::Error::new(
        std::io::ErrorKind::NotFound,
        format!("no pty session with id {id:?}"),
    )
}

impl SessionManager {
    pub fn new() -> Self {
        Self::default()
    }

    fn lock(&self) -> MutexGuard<'_, HashMap<String, PtySession>> {
        // Recover from a poisoned lock: one panicked reader thread must not
        // brick every terminal in the app.
        self.sessions.lock().unwrap_or_else(|e| e.into_inner())
    }

    /// Spawn a new session under `id`. Errors if the id is already in use.
    pub fn spawn<F, G>(
        &self,
        id: impl Into<String>,
        config: PtyConfig,
        on_output: F,
        on_exit: G,
    ) -> std::io::Result<()>
    where
        F: Fn(Vec<u8>) + Send + 'static,
        G: FnOnce() + Send + 'static,
    {
        let id = id.into();
        let mut sessions = self.lock();
        if sessions.contains_key(&id) {
            return Err(std::io::Error::new(
                std::io::ErrorKind::AlreadyExists,
                format!("pty session id {id:?} is already in use"),
            ));
        }
        let session = PtySession::spawn(config, on_output, on_exit)?;
        sessions.insert(id, session);
        Ok(())
    }

    pub fn contains(&self, id: &str) -> bool {
        self.lock().contains_key(id)
    }

    pub fn len(&self) -> usize {
        self.lock().len()
    }

    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }

    /// Write bytes to a session's stdin. Errors if the id is unknown.
    pub fn write(&self, id: &str, data: &[u8]) -> std::io::Result<()> {
        let mut sessions = self.lock();
        let session = sessions.get_mut(id).ok_or_else(|| not_found(id))?;
        session.write(data)
    }

    /// Resize a session's PTY. Errors if the id is unknown.
    pub fn resize(&self, id: &str, cols: u16, rows: u16) -> std::io::Result<()> {
        let sessions = self.lock();
        let session = sessions.get(id).ok_or_else(|| not_found(id))?;
        session.resize(cols, rows)
    }

    /// Kill a session and drop it from the registry. Errors if the id is unknown.
    pub fn kill(&self, id: &str) -> std::io::Result<()> {
        let mut session = self.lock().remove(id).ok_or_else(|| not_found(id))?;
        session.kill()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_config() -> PtyConfig {
        PtyConfig {
            shell: "/bin/sh".into(),
            args: vec![],
            cwd: None,
            cols: 80,
            rows: 24,
        }
    }

    #[test]
    fn spawn_registers_a_session() {
        let mgr = SessionManager::new();
        mgr.spawn("pane-1", test_config(), |_| {}, || {}).unwrap();
        assert!(mgr.contains("pane-1"));
        assert_eq!(mgr.len(), 1);
    }

    #[test]
    fn spawn_rejects_a_duplicate_id() {
        let mgr = SessionManager::new();
        mgr.spawn("pane-1", test_config(), |_| {}, || {}).unwrap();

        let err = mgr
            .spawn("pane-1", test_config(), |_| {}, || {})
            .expect_err("duplicate id must be rejected");

        assert_eq!(err.kind(), std::io::ErrorKind::AlreadyExists);
        assert_eq!(mgr.len(), 1, "a rejected spawn must not register anything");
    }

    #[test]
    fn operations_on_an_unknown_id_report_not_found() {
        let mgr = SessionManager::new();
        assert_eq!(
            mgr.write("ghost", b"x").unwrap_err().kind(),
            std::io::ErrorKind::NotFound
        );
        assert_eq!(
            mgr.resize("ghost", 80, 24).unwrap_err().kind(),
            std::io::ErrorKind::NotFound
        );
        assert_eq!(
            mgr.kill("ghost").unwrap_err().kind(),
            std::io::ErrorKind::NotFound
        );
    }

    #[test]
    fn kill_drops_the_session_from_the_registry() {
        let mgr = SessionManager::new();
        mgr.spawn("pane-1", test_config(), |_| {}, || {}).unwrap();

        mgr.kill("pane-1").unwrap();

        assert!(!mgr.contains("pane-1"));
        assert!(mgr.is_empty());
    }
}
