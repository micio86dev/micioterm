import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

/** Options for spawning a shell on a fresh PTY. */
export interface SpawnOptions {
  sessionId: string;
  shell?: string;
  args?: string[];
  cwd?: string;
  cols: number;
  rows: number;
}

/** Decode base64 output (from the backend) into raw bytes for xterm. */
function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * Subscribe to a session's shell output. Call this BEFORE {@link ptySpawn} so no
 * bytes (including the startup banner) are missed between spawn and subscription.
 */
export function onPtyOutput(
  sessionId: string,
  handler: (bytes: Uint8Array) => void,
): Promise<UnlistenFn> {
  return listen<string>(`pty://output/${sessionId}`, (event) => {
    handler(base64ToBytes(event.payload));
  });
}

/** Subscribe to a session's exit (the shell process ended, e.g. Ctrl+D). */
export function onPtyExit(sessionId: string, handler: () => void): Promise<UnlistenFn> {
  return listen(`pty://exit/${sessionId}`, () => handler());
}

export function ptySpawn(opts: SpawnOptions): Promise<void> {
  return invoke("pty_spawn", {
    sessionId: opts.sessionId,
    shell: opts.shell ?? null,
    args: opts.args ?? null,
    cwd: opts.cwd ?? null,
    cols: opts.cols,
    rows: opts.rows,
  });
}

export function ptyWrite(sessionId: string, data: string): Promise<void> {
  return invoke("pty_write", { sessionId, data });
}

export function ptyResize(sessionId: string, cols: number, rows: number): Promise<void> {
  return invoke("pty_resize", { sessionId, cols, rows });
}

export function ptyKill(sessionId: string): Promise<void> {
  return invoke("pty_kill", { sessionId });
}
