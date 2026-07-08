import { invoke } from "@tauri-apps/api/core";

import { parseSession, type SessionSnapshot } from "../core/session";

/**
 * Session persistence backed by a JSON file on disk (via the Rust
 * `save_session`/`load_session` commands). We use a real file rather than
 * localStorage because WebKit may not flush localStorage to disk before the app
 * is terminated with ⌘Q — so recent changes were being lost across restarts.
 */

export async function loadSession(): Promise<SessionSnapshot | null> {
  try {
    const raw = await invoke<string | null>("load_session");
    return raw ? parseSession(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

export function saveSession(snapshot: SessionSnapshot): void {
  void invoke("save_session", { snapshot: JSON.stringify(snapshot) }).catch((error) => {
    // Session persistence is the only durability path — don't fail silently.
    console.warn("[micioterm] failed to save session", error);
  });
}
