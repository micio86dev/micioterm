//! A single PTY session: the master side of one pseudo-terminal, a dedicated
//! OS thread that drains its output, and a handle to write/resize/kill it.
//!
//! One [`PtySession`] backs exactly one pane for the pane's whole lifetime.

use std::io::{Read, Write};
use std::thread::JoinHandle;

use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};

use super::clamp_dimensions;

/// How to start a shell for a pane.
pub struct PtyConfig {
    /// Absolute path to the shell binary (e.g. `/bin/zsh`).
    pub shell: String,
    /// Extra arguments (e.g. `-l` for a login shell).
    pub args: Vec<String>,
    /// Working directory; `None` inherits the app's cwd.
    pub cwd: Option<String>,
    pub cols: u16,
    pub rows: u16,
}

/// A live PTY. Dropping it stops the reader thread once the child closes the pty.
pub struct PtySession {
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    child: Box<dyn Child + Send + Sync>,
    reader: Option<JoinHandle<()>>,
}

fn to_io_err<E: std::fmt::Display>(e: E) -> std::io::Error {
    std::io::Error::new(std::io::ErrorKind::Other, e.to_string())
}

impl PtySession {
    /// Spawn a shell on a fresh PTY. `on_output` is invoked from a dedicated
    /// reader thread with each chunk of bytes the shell produces, until EOF.
    pub fn spawn<F, G>(config: PtyConfig, on_output: F, on_exit: G) -> std::io::Result<Self>
    where
        F: Fn(Vec<u8>) + Send + 'static,
        G: FnOnce() + Send + 'static,
    {
        let (cols, rows) = clamp_dimensions(config.cols, config.rows);
        let pty_system = native_pty_system();
        let pair = pty_system
            .openpty(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(to_io_err)?;

        let mut cmd = CommandBuilder::new(&config.shell);
        for arg in &config.args {
            cmd.arg(arg);
        }
        // Inherit the launching environment (PATH, HOME, LANG…) so real tools
        // work, then guarantee a sane TERM for xterm.js.
        for (key, value) in std::env::vars() {
            cmd.env(key, value);
        }
        cmd.env("TERM", "xterm-256color");
        // A restored cwd may no longer exist (dir deleted since last run); fall
        // back to the inherited cwd rather than failing the spawn.
        if let Some(cwd) = &config.cwd {
            if std::path::Path::new(cwd).is_dir() {
                cmd.cwd(cwd);
            }
        }

        let child = pair.slave.spawn_command(cmd).map_err(to_io_err)?;
        // Drop the slave so the master observes EOF once the child exits.
        drop(pair.slave);

        let mut reader = pair.master.try_clone_reader().map_err(to_io_err)?;
        let writer = pair.master.take_writer().map_err(to_io_err)?;

        let reader_handle = std::thread::spawn(move || {
            let mut buf = [0u8; 8192];
            loop {
                match reader.read(&mut buf) {
                    Ok(0) => break, // EOF: the child closed the pty
                    Ok(n) => on_output(buf[..n].to_vec()),
                    Err(_) => break,
                }
            }
            // The shell exited (e.g. Ctrl+D at the prompt): notify the frontend.
            on_exit();
        });

        Ok(Self {
            master: pair.master,
            writer,
            child,
            reader: Some(reader_handle),
        })
    }

    /// Send keystrokes / bytes to the shell's stdin.
    pub fn write(&mut self, data: &[u8]) -> std::io::Result<()> {
        self.writer.write_all(data)?;
        self.writer.flush()
    }

    /// The child shell's OS process id, if still running. Used to look up its
    /// working directory for session restore.
    pub fn process_id(&self) -> Option<u32> {
        self.child.process_id()
    }

    /// Resize the PTY. Dimensions are clamped to a valid size first.
    pub fn resize(&self, cols: u16, rows: u16) -> std::io::Result<()> {
        let (cols, rows) = clamp_dimensions(cols, rows);
        self.master
            .resize(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(to_io_err)
    }

    /// Kill the child process. The reader thread ends when the pty reaches EOF.
    pub fn kill(&mut self) -> std::io::Result<()> {
        self.child.kill()
    }
}

impl Drop for PtySession {
    /// Closing a pane must not leave an orphaned shell or reader thread: kill the
    /// child (SIGKILL cannot be ignored, so the pty EOFs) and join the reader.
    fn drop(&mut self) {
        let _ = self.child.kill();
        if let Some(handle) = self.reader.take() {
            let _ = handle.join();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::mpsc::{channel, RecvTimeoutError};
    use std::time::{Duration, Instant};

    /// End-to-end proof the pty path is real: write a command, read it back.
    #[test]
    fn echo_round_trips_through_the_pty() {
        let (tx, rx) = channel::<Vec<u8>>();
        let mut session = PtySession::spawn(
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
        .expect("pty should spawn");

        session
            .write(b"echo micio_ok\n")
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

        let _ = session.kill();
        assert!(
            String::from_utf8_lossy(&acc).contains("micio_ok"),
            "expected shell output to contain the token, got: {:?}",
            String::from_utf8_lossy(&acc)
        );
    }
}
