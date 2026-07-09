import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

import { invoke } from "@tauri-apps/api/core";
import { SESSION_VERSION, type SessionSnapshot } from "../core/session";
import { loadSession, saveSession } from "./store";

const invokeMock = vi.mocked(invoke);

const snapshot: SessionSnapshot = {
  version: SESSION_VERSION,
  activeTabIndex: 0,
  tabs: [
    {
      title: "T",
      orientation: "vertical",
      activePaneIndex: 0,
      panes: [{ cwd: "/x", name: "api" }],
    },
  ],
};

beforeEach(() => invokeMock.mockReset());

describe("loadSession", () => {
  it("parses a stored JSON snapshot", async () => {
    invokeMock.mockResolvedValue(JSON.stringify(snapshot));
    await expect(loadSession()).resolves.toEqual(snapshot);
    expect(invokeMock).toHaveBeenCalledWith("load_session");
  });

  it("returns null when nothing is stored", async () => {
    invokeMock.mockResolvedValue(null);
    await expect(loadSession()).resolves.toBeNull();
  });

  it("returns null on corrupt JSON", async () => {
    invokeMock.mockResolvedValue("{not json");
    await expect(loadSession()).resolves.toBeNull();
  });

  it("returns null when the command rejects", async () => {
    invokeMock.mockRejectedValueOnce(new Error("io"));
    await expect(loadSession()).resolves.toBeNull();
  });
});

describe("saveSession", () => {
  it("invokes save_session with the serialized snapshot", () => {
    invokeMock.mockResolvedValue(undefined);
    saveSession(snapshot);
    expect(invokeMock).toHaveBeenCalledWith("save_session", {
      snapshot: JSON.stringify(snapshot),
    });
  });

  it("swallows a save failure (logs, does not throw)", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    invokeMock.mockRejectedValueOnce(new Error("disk full"));
    expect(() => saveSession(snapshot)).not.toThrow();
    await Promise.resolve();
    await Promise.resolve();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
