/**
 * Session snapshot model + validation. A snapshot captures the tab/pane layout
 * (and each pane's working directory) so the app can be rebuilt on next launch.
 *
 * Shell processes cannot be resurrected across restarts — this restores the
 * STRUCTURE and reopens fresh shells in the saved directories.
 *
 * `parseSession` is pure and defensive: it never trusts the persisted blob
 * (it may be corrupt, from an older version, or hand-edited), clamping and
 * dropping anything malformed so restore can't crash the app.
 */

import type { SplitDirection } from "./layout";
import { MAX_PANES } from "./layout";

/** Reasonable ceiling so a corrupt blob can't spawn thousands of tabs. */
export const MAX_TABS = 50;

export const SESSION_VERSION = 1;

export interface PaneSnapshot {
  /** Working directory to reopen the shell in, or null for the default. */
  readonly cwd: string | null;
  /** User-given pane label (e.g. the project), or null. */
  readonly name: string | null;
}

export interface TabSnapshot {
  readonly title: string;
  /** Split orientation (only meaningful for a 2-pane tab). */
  readonly orientation: SplitDirection;
  readonly activePaneIndex: number;
  readonly panes: readonly PaneSnapshot[];
}

export interface SessionSnapshot {
  readonly version: typeof SESSION_VERSION;
  readonly activeTabIndex: number;
  readonly tabs: readonly TabSnapshot[];
}

/**
 * Validate an untrusted, parsed JSON value into a {@link SessionSnapshot}, or
 * `null` if it isn't a usable current-version snapshot. Over-long lists are
 * truncated and out-of-range indices clamped.
 */
export function parseSession(raw: unknown): SessionSnapshot | null {
  if (!isObject(raw) || raw.version !== SESSION_VERSION || !Array.isArray(raw.tabs)) {
    return null;
  }

  const tabs: TabSnapshot[] = [];
  for (const candidate of raw.tabs.slice(0, MAX_TABS)) {
    const tab = parseTab(candidate);
    if (tab) {
      tabs.push(tab);
    }
  }
  if (tabs.length === 0) {
    return null;
  }

  return {
    version: SESSION_VERSION,
    activeTabIndex: clampIndex(raw.activeTabIndex, tabs.length),
    tabs,
  };
}

function parseTab(raw: unknown): TabSnapshot | null {
  if (!isObject(raw) || !Array.isArray(raw.panes)) {
    return null;
  }
  const panes = raw.panes.slice(0, MAX_PANES).map(parsePane);
  if (panes.length === 0) {
    return null;
  }
  return {
    title: typeof raw.title === "string" ? raw.title : "Terminal",
    orientation: raw.orientation === "horizontal" ? "horizontal" : "vertical",
    activePaneIndex: clampIndex(raw.activePaneIndex, panes.length),
    panes,
  };
}

function parsePane(raw: unknown): PaneSnapshot {
  const cwd = isObject(raw) && typeof raw.cwd === "string" ? raw.cwd : null;
  const name = isObject(raw) && typeof raw.name === "string" ? raw.name : null;
  return { cwd, name };
}

function clampIndex(value: unknown, length: number): number {
  const n = typeof value === "number" && Number.isInteger(value) ? value : 0;
  return Math.min(Math.max(n, 0), length - 1);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
