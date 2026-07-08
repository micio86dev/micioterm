# MicioTerm

A native, installable **macOS terminal emulator** with MicioDev branding — a
translucent, blurred dark window, neon-green text, a solid blinking green block
cursor, tabs, up to 4 panes per tab, and a baked-in startup banner.

Built with **Tauri v2** (Rust backend + WKWebView frontend) and **xterm.js**, one
`portable-pty` pseudo-terminal per pane.

---

## Requirements

- macOS (Apple Silicon or Intel)
- [Node.js](https://nodejs.org) ≥ 20 and [pnpm](https://pnpm.io) ≥ 9
- [Rust](https://rustup.rs) (stable) with the Apple targets:
  ```sh
  rustup target add aarch64-apple-darwin x86_64-apple-darwin
  ```
- Xcode Command Line Tools (`xcode-select --install`)

## Development

```sh
pnpm install
pnpm tauri dev      # launches the app with hot-reload
```

The dev window opens translucent (the real behind-window blur needs the native
build path, which `tauri dev` uses).

### Everyday commands

| Command | What it does |
| --- | --- |
| `pnpm tauri dev` | Run the app with frontend hot-reload |
| `pnpm test` | Run the TypeScript unit tests (Vitest) |
| `pnpm typecheck` | Type-check the frontend (`tsc --noEmit`) |
| `pnpm build` | Type-check + build the frontend bundle |
| `cargo test` | Run the Rust tests (from `src-tauri/`) |
| `pnpm package:mac` | Build a **universal** `.app` + `.dmg` (see Packaging) |

### Tests

- **Rust** (`src-tauri/`): session-manager lifecycle, resize math, config
  parsing/defaults/merge, the banner, and a PTY echo round-trip integration test
  (`cargo test`).
- **TypeScript** (`src/core/`): the pure tab and pane-layout state machines
  (`pnpm test`). Rendering and visual polish are verified manually.

## Configuration

Zero config required — sane defaults match the visual spec. To customize, create:

```
~/Library/Application Support/com.miciodev.terminal/config.toml
```

All keys are optional; unset keys fall back to the defaults below. A missing or
invalid file falls back to the defaults (an invalid file is logged, never fatal).

```toml
# Background tint opacity over the window blur (0.0–1.0).
opacity = 0.82

# macOS blur material: "hud" or "under-window".
blur_material = "hud"

# Terminal font (must be installed or bundled) and size.
font_family = "JetBrains Mono"
font_size = 14

cursor_blink = true       # blinking block cursor
watermark = true          # centered logo watermark behind the panes
show_banner = true         # print the MicioDev banner in every new pane
scrollback = 10000         # scrollback buffer, in lines

# Login shell. Omit to use $SHELL (falling back to /bin/zsh).
# default_shell = "/bin/zsh"

# Individual ANSI/UI color overrides. Any subset is allowed.
[palette]
foreground = "#2fff5a"
cursor     = "#2fff5a"
# black = "#15161b"  red = "#ff5c57"  green = "#2fff5a"  yellow = "#f3f99d"
# blue = "#57c7ff"  magenta = "#ff6ac1"  cyan = "#9aedfe"  white = "#e6e6e6"
# bright_black … bright_white likewise
```

## Branding

The MicioDev logo (neon-green cat / monitor / code mark) lives at
`src/assets/miciodev-logo.jpg` and is used in the tab bar and as the centered
watermark. The **app icon** (`src-tauri/icons/*`) is that logo composed inside an
iTerm2-style terminal window (dark squircle, title-bar traffic lights, neon-green
glowing border).

To swap the logo:

1. Replace `src/assets/miciodev-logo.jpg` (a square image renders best).
2. Regenerate the app icons from a 1024×1024 source PNG:
   ```sh
   pnpm tauri icon path/to/icon-1024.png
   ```
   This overwrites `src-tauri/icons/*` (used for the `.app`/`.dmg` icon).
3. Rebuild.

The in-terminal ASCII startup banner (§4.1) is a fixed asset baked into the Rust
backend (`src-tauri/src/banner.rs`) — it is intentionally not regenerated.

## Packaging & distribution

Build an Apple-Silicon `.app` and `.dmg`:

```sh
pnpm package:mac
# → src-tauri/target/aarch64-apple-darwin/release/bundle/{macos,dmg}/
```

### Universal binary (Apple Silicon + Intel)

```sh
pnpm package:mac:universal
# → src-tauri/target/universal-apple-darwin/release/bundle/{macos,dmg}/
```

> **Toolchain note.** The universal build cross-compiles to `x86_64`, so the
> active `cargo`/`rustc` must ship **both** target standard libraries. `rustup`
> does once you run `rustup target add aarch64-apple-darwin x86_64-apple-darwin`.
> A Homebrew-installed Rust (`/opt/homebrew/bin/rustc`) only carries the host
> target and will fail with `can't find crate for core` — use `rustup` (ensure
> `~/.cargo/bin` precedes `/opt/homebrew/bin` on `PATH`) or build arm64-only.

Without signing credentials these produce an **unsigned / ad-hoc** build, fine
for local use. For distribution, sign and notarize with a Developer ID.

### Signing + notarization checklist (Developer ID)

Never hardcode secrets — `tauri build` reads them from the environment.

1. **Signing identity** — a "Developer ID Application" certificate in your login
   keychain. Point Tauri at it:
   ```sh
   export APPLE_SIGNING_IDENTITY="Developer ID Application: Your Name (TEAMID)"
   ```
   Or supply the cert as base64 for CI:
   ```sh
   export APPLE_CERTIFICATE="$(base64 -i DeveloperID.p12)"
   export APPLE_CERTIFICATE_PASSWORD="…"
   ```
2. **Notarization credentials** — either an App Store Connect API key **or** an
   Apple ID app-specific password:
   ```sh
   # Option A — API key (recommended for CI)
   export APPLE_API_KEY="…"           # key id
   export APPLE_API_ISSUER="…"        # issuer id
   export APPLE_API_KEY_PATH="AuthKey_XXXX.p8"

   # Option B — Apple ID
   export APPLE_ID="you@example.com"
   export APPLE_PASSWORD="app-specific-password"
   export APPLE_TEAM_ID="TEAMID"
   ```
3. **Build** — Tauri signs, then notarizes and staples the ticket:
   ```sh
   pnpm package:mac
   ```
4. **Verify**:
   ```sh
   spctl --assess --type execute -vv "path/to/MicioTerm.app"
   xcrun stapler validate "path/to/MicioTerm.dmg"
   ```

The bundle identifier is `com.miciodev.terminal`.

## Architecture

```
WKWebView (TypeScript)
  App ── TabBar ── Tab[] ── PaneGrid (1–4 panes, CSS grid) ── Pane ── xterm.js
                                each Pane ⇄ one backend PTY (event channel)
        │ Tauri IPC (commands + pty://output/<id> events)
Rust backend
  SessionManager: HashMap<SessionId, PtySession>
  PtySession: portable-pty master + reader thread + writer
  commands: pty_spawn / pty_write / pty_resize / pty_kill / get_config
```

- **One PTY per pane** for the pane's whole lifetime.
- The frontend never parses escape sequences: bytes stream into `xterm.write()`,
  keystrokes stream out via `pty_write`.
- Resize is authoritative from the frontend (`FitAddon` → `pty_resize`).

Key paths: `src/core/` (pure tab/layout state machines), `src/terminal/` (xterm +
IPC bridge), `src/ui/` (tab bar, pane grid, keybindings), `src/theme/` &
`src/config/`; `src-tauri/src/pty/`, `config.rs`, `banner.rs`, `window.rs`.

## Keyboard shortcuts

| Shortcut | Action |
| --- | --- |
| ⌘T / ⌘W | New tab / close active pane (cascades to tab, then window) |
| ⌃Tab, ⌘⇧] / ⌘⇧[ | Cycle tabs |
| ⌘D / ⌘⇧D | Split pane left/right · top/bottom (max 4) |
| ⌘⌥← ↑ → ↓ | Move focus between panes |
| ⌃⌘F | Toggle fullscreen |
| ⌘C / ⌘V | Copy selection / paste |

## Non-goals (v1)

Windows/Linux, a settings GUI, a theme/plugin system, drag-to-resize splits,
session restore, and SSH profile management are out of scope for this release.
