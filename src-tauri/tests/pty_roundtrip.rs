//! Integration test (spec §6): spawn a shell through the public `SessionManager`
//! API, write a command, and assert its output comes back on the output channel.
//! The `on_output` closure stands in for the `pty://output/<id>` Tauri event.

use std::sync::mpsc::{channel, RecvTimeoutError};
use std::time::{Duration, Instant};

use app_lib::pty::manager::SessionManager;
use app_lib::pty::session::PtyConfig;

#[test]
fn echo_round_trips_through_the_session_manager() {
    let (tx, rx) = channel::<Vec<u8>>();
    let manager = SessionManager::new();

    manager
        .spawn(
            "pane-1",
            PtyConfig {
                shell: "/bin/sh".into(),
                args: vec![],
                cwd: None,
                cols: 80,
                rows: 24,
            },
            move |bytes| {
                let _ = tx.send(bytes);
            },
            || {},
        )
        .expect("session should spawn");

    manager
        .write("pane-1", b"echo micio_ok\n")
        .expect("write should succeed");

    let mut acc = Vec::new();
    let deadline = Instant::now() + Duration::from_secs(5);
    while Instant::now() < deadline {
        match rx.recv_timeout(Duration::from_millis(200)) {
            Ok(chunk) => {
                acc.extend_from_slice(&chunk);
                if String::from_utf8_lossy(&acc).contains("micio_ok") {
                    break;
                }
            }
            Err(RecvTimeoutError::Timeout) => {}
            Err(RecvTimeoutError::Disconnected) => break,
        }
    }

    let _ = manager.kill("pane-1");
    assert!(
        String::from_utf8_lossy(&acc).contains("micio_ok"),
        "expected output channel to carry the token, got: {:?}",
        String::from_utf8_lossy(&acc)
    );
}
