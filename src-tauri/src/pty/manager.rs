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

    /// The current working directory of a session's shell, for session restore.
    /// Best-effort: `None` if the id is unknown, the shell exited, or the cwd
    /// can't be resolved.
    pub fn cwd(&self, id: &str) -> Option<String> {
        let pid = self.lock().get(id)?.process_id()?;
        process_cwd(pid)
    }
}

/// Resolve a process's working directory. macOS has no `/proc`, so we ask
/// `lsof` for the single `cwd` descriptor of one pid — fast and dependency-free.
#[cfg(target_os = "macos")]
fn process_cwd(pid: u32) -> Option<String> {
    use std::process::{Command, Stdio};
    use std::sync::mpsc;
    use std::time::Duration;

    let child = Command::new("lsof")
        .args(["-a", "-p", &pid.to_string(), "-d", "cwd", "-Fn"])
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .ok()?;

    // Bound the wait: a hung lsof (e.g. a stalled mount) must not tie up the
    // caller. On timeout we give up; the reader thread reaps the child later.
    let (tx, rx) = mpsc::channel();
    std::thread::spawn(move || {
        let _ = tx.send(child.wait_with_output());
    });
    let output = match rx.recv_timeout(Duration::from_millis(1500)) {
        Ok(Ok(output)) if output.status.success() => output,
        _ => return None,
    };

    // `-Fn` prints field-prefixed lines; the cwd path is the `n`-prefixed one.
    String::from_utf8_lossy(&output.stdout)
        .lines()
        .find_map(|line| line.strip_prefix('n').map(str::to_string))
}

#[cfg(not(target_os = "macos"))]
fn process_cwd(_pid: u32) -> Option<String> {
    None
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
    #[cfg(target_os = "macos")]
    fn cwd_reports_the_shell_working_directory() {
        use std::time::{Duration, Instant};

        // Canonicalize because macOS /tmp is a symlink to /private/tmp and lsof
        // returns the real path.
        let dir = std::fs::canonicalize(std::env::temp_dir()).unwrap();
        let mgr = SessionManager::new();
        mgr.spawn(
            "pane-cwd",
            PtyConfig {
                shell: "/bin/sh".into(),
                args: vec![],
                cwd: Some(dir.to_string_lossy().into_owned()),
                cols: 80,
                rows: 24,
            },
            |_| {},
            || {},
        )
        .unwrap();

        // The shell needs a moment to be visible to lsof.
        let deadline = Instant::now() + Duration::from_secs(3);
        let mut got = None;
        while Instant::now() < deadline {
            if let Some(cwd) = mgr.cwd("pane-cwd") {
                got = Some(cwd);
                break;
            }
            std::thread::sleep(Duration::from_millis(50));
        }

        mgr.kill("pane-cwd").ok();
        assert_eq!(got.as_deref(), Some(dir.to_string_lossy().as_ref()));
    }

    #[test]
    fn cwd_of_unknown_session_is_none() {
        let mgr = SessionManager::new();
        assert_eq!(mgr.cwd("ghost"), None);
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
