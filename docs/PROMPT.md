# Claude Code Prompt — MicioDev Terminal

> Paste this into Claude Code (plan mode, Opus). It follows spec-driven development: read the whole spec, produce a plan, get it approved, then implement phase by phase with TDD. Do **not** start coding before the plan is approved.

---

## 1. Objective

Build **MicioDev Terminal**, a native, installable macOS terminal emulator app with MicioDev branding. It supports multiple tabs, up to 4 panes per tab, a translucent blurred dark theme, green primary text, white secondary text, and a solid blinking green block cursor. The deliverable is a signed, notarized `.dmg`.

This is a real product, not a throwaway. Code quality, tests, and a clean architecture matter as much as the visible result.

## 2. Locked technology decision

Do not re-litigate the stack. These choices are final:

- **Shell / app framework:** Tauri v2 (Rust backend + WKWebView frontend).
- **Terminal rendering:** xterm.js (`@xterm/xterm`) with `@xterm/addon-fit` and `@xterm/addon-web-links`. Use the WebGL renderer addon (`@xterm/addon-webgl`) with a canvas fallback.
- **PTY:** the `portable-pty` Rust crate (same core WezTerm uses). One PTY per pane.
- **Frontend language:** TypeScript. **No heavy UI framework** — vanilla TS + a thin reactive layer is enough; do not pull in React/Vue for this.
- **Bundler:** Vite.
- **Styling:** plain CSS with custom properties (design tokens). No Tailwind.
- **IPC:** Tauri commands + an event channel per PTY for streaming output.

Rationale is already settled; if you believe a genuinely blocking technical constraint exists, raise it in the plan rather than silently substituting a different tool.

## 3. Architecture

```
┌──────────────────────── WKWebView (TS) ────────────────────────┐
│  TabBar ── Tab[] ── PaneLayout (1–4 panes, CSS grid)           │
│                       └── Pane ── xterm.js instance            │
│  each Pane <-> a backend PTY session over a Tauri event channel │
└───────────────────────────────────────────────────────────────┘
                      │ Tauri IPC (commands + events)
┌───────────────────────────────────────────────────────────────┐
│  Rust backend                                                 │
│   session manager: HashMap<SessionId, PtySession>             │
│   PtySession: portable-pty master + reader thread + writer    │
│   commands: pty_spawn / pty_write / pty_resize / pty_kill      │
│   events:   pty://output/<session_id>  (streamed bytes)       │
└───────────────────────────────────────────────────────────────┘
```

Key rules:
- **One PTY per pane.** A pane owns exactly one session id for its whole lifetime.
- Backend reader threads must not block the async runtime; use a dedicated thread per PTY that forwards chunks onto the event channel.
- Frontend never parses escape sequences itself — bytes go straight into xterm.js `.write()`, and keystrokes go straight out via `pty_write`.
- Resize is authoritative from the frontend: `FitAddon` computes cols/rows, frontend calls `pty_resize`, backend calls `PtyMaster::resize`.

## 4. Visual spec (exact)

Design tokens (define once as CSS custom properties, reuse everywhere):

- Background: pure black at ~82% opacity (`rgba(0,0,0,0.82)`) so the OS blur shows through. Expose opacity as a config value.
- Window blur: real behind-window blur via Tauri macOS window effects (`NSVisualEffectView` / `hudWindow` or `underWindowBackground` material). The webview root and body must be transparent for the blur to be visible — set `"transparent": true` in the Tauri window config and `background: transparent` in CSS.
- Primary text (foreground): neon green — `#2fff5a` (same green as the startup banner in §4.1; document the hex, keep it tunable via config).
- Secondary text (UI chrome, inactive tab labels, path hints): white `#ffffff` at reduced opacity for hierarchy.
- Cursor: **block** style, solid, **blinking**, green (matches foreground). xterm options: `cursorStyle: 'block'`, `cursorBlink: true`.
- xterm theme: black transparent background, green foreground, green cursor, a sensible ANSI 16-color palette that stays readable on the dark translucent bg (define all 16).
- Font: a bundled monospace (e.g. JetBrains Mono or a Nerd Font variant) so glyphs/powerline render everywhere; ligatures optional and off by default.
- **MicioDev logo (raster/UI):** shown in the tab bar (left side) and as an optional very-low-opacity centered background watermark behind the panes (togglable, default on, ~4% opacity). Provide an asset slot at `src/assets/miciodev-logo.svg`; the real neon-green cat/monitor/cone SVG will be dropped in there. Use a placeholder if none is supplied and note that it should be replaced. This is where the neon *glow* lives (the terminal text banner in §4.1 can't reproduce bloom).
- Active pane: a subtle 1px green border/glow; inactive panes dimmed slightly so focus is obvious.

### 4.1 Startup banner (in-terminal ASCII logo)

Every newly spawned pane prints the MicioDev logo as its first output, before the shell prompt. This is baked into the app, not the user's shell config: the Rust backend writes the banner bytes to the PTY (or emits them on the output channel) immediately after spawn, once per session. Make it togglable via config (`show_banner = true`).

The banner is the following art, printed in neon green `#2fff5a` (bold), with a bright-green ANSI fallback (`\033[1;92m`) for non-truecolor terminals. Reset color after. Store it as `src/assets/banner.txt` (or a Rust `const`), and treat it as a fixed asset — do **not** regenerate or "improve" it:

```
          ╱╲                 ╱╲
         ╱  ╲               ╱  ╲
        ╱    ╲             ╱    ╲
       ╱      ╲           ╱      ╲
      ╱        ╲_________╱        ╲
     ╱                             ╲
    ╱                               ╲
   ╱                                 ╲
   ╭──────────────────────────────────╮
   │                                  │
   │          ╱       ╱    ╲          │
   │         ╱       ╱      ╲         │
   │         ╲      ╱       ╱         │
   │          ╲    ╱       ╱          │
   │                                  │
   ╰──────────────────────────────────╯
                  ╲    ╱
                   ╲  ╱
              ╲_____________╱
              ╲             ╱
               ╲        ╱  ╱
                ╲      ╱  ╱
                 ╲    ╱  ╱
                  ╲  ╱  ╱
                   ╲   ╱
                    ╲ ╱

            M I C I O D E V
```

The art uses box-drawing and slash glyphs (`╱ ╲ │ ╭ ─`), so the bundled monospace font (§4, JetBrains Mono / Nerd Font) must render these cleanly at the default size — verify the banner looks aligned in that exact font as part of theming acceptance.

## 5. Functional requirements

### Tabs
- Open new tab (⌘T), close tab (⌘W), cycle tabs (⌃Tab / ⌘⇧[ / ⌘⇧]), click to switch.
- New tab starts with a single pane running the user's default login shell (`$SHELL`, fallback `/bin/zsh`).
- Closing the last tab closes the window/app (standard macOS behavior).

### Panes (max 4 per tab)
- Split horizontally (⌘D) and vertically (⌘⇧D).
- Enforce the hard cap of **4 panes per tab** — the 5th split is a no-op with a subtle UI hint.
- Layouts to support cleanly: 1 pane (full), 2 panes (split), 3 panes (2+1), 4 panes (2×2 grid). Use CSS grid; recompute `FitAddon` on every layout change and window resize.
- Focus follows click; ⌘⌥Arrow moves focus between panes directionally.
- Closing a pane reflows the remaining panes; closing the last pane in a tab closes the tab.

### Terminal behavior
- Full interactive shell: run vim, htop, tmux, ssh, etc. (this is what the PTY + xterm.js buys you — verify it actually works, don't assume).
- Copy/paste (⌘C / ⌘V) with the usual "copy on selection is off, ⌘C copies selection" semantics.
- Clickable URLs via the web-links addon.
- Scrollback buffer (default 10,000 lines), configurable.
- Correct handling of window/pane resize while a full-screen TUI app is running.

### Config
- A single TOML config file in the app config dir (e.g. `~/Library/Application Support/com.miciodev.terminal/config.toml`) controlling: background opacity, blur material, font family/size, palette overrides, cursor blink on/off, watermark on/off, startup banner on/off (`show_banner`), default shell, scrollback.
- Ship sane defaults matching the visual spec so it works with zero config.

## 6. TDD expectations

Test the logic that can be tested without a GUI:

- **Rust:** session manager (spawn/register/lookup/kill lifecycle), resize math, config parsing/defaults/merge. PTY spawn + echo round-trip as an integration test (write `echo hi\n`, assert `hi` comes back on the output channel).
- **TS:** pane-layout state machine — split/close/cap-at-4, focus movement, tab open/close/cycle. Pure functions over a layout model, tested with Vitest, no DOM needed.
- Write the failing test first for each unit of layout/session logic, then implement. Rendering/visual polish is verified manually and doesn't need unit tests.

## 7. Packaging & distribution

- Configure Tauri bundling to produce a `.app` and `.dmg`.
- Set up code signing + notarization (Developer ID). Document the exact steps and required env vars (`APPLE_CERTIFICATE`, `APPLE_ID`, `APPLE_PASSWORD`/notarytool, team id) in the README — do **not** hardcode secrets.
- Set the bundle identifier `com.miciodev.terminal`, app name "MicioDev Terminal", and wire the app icon from the MicioDev logo.
- Target both Apple Silicon and Intel (universal binary) if feasible; otherwise document arm64-only.

## 8. Deliverables

1. A working Tauri v2 project that builds and runs on macOS.
2. Passing Rust + TS test suites.
3. A `README.md` covering: dev setup, `pnpm`/`cargo` commands, config file reference, how to drop in the real logo, and the full signing/notarization checklist.
4. The visible result matching section 4 exactly: translucent blurred black window, green text, white secondary text, blinking green block cursor, tabs, up to 4 panes, MicioDev branding, and the §4.1 startup banner printed in neon green in every new pane.

## 9. Non-goals (do not build now)

- Windows/Linux support (macOS only for v1).
- A settings GUI (TOML file is enough).
- Themes/plugin system, split resizing by drag, session restore, or SSH profile management — note them as future work, don't implement.

## 10. Working process

1. Read this whole spec.
2. Produce a phased implementation plan (suggested phases: PTY backend + single pane → tabs → pane splitting/layout → theming/branding → config → packaging), each phase ending in a runnable, tested state.
3. **Wait for approval**, then implement phase by phase, running tests as you go, and pause at each phase boundary so I can see the result.