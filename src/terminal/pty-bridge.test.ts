import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  onPtyExit,
  onPtyOutput,
  ptyCwd,
  ptyKill,
  ptyResize,
  ptySpawn,
  ptyWrite,
} from "./pty-bridge";

const invokeMock = vi.mocked(invoke);
const listenMock = vi.mocked(listen);

beforeEach(() => {
  invokeMock.mockReset();
  listenMock.mockReset();
  invokeMock.mockResolvedValue(undefined);
  listenMock.mockResolvedValue(() => {});
});

describe("pty command wrappers", () => {
  it("spawns with nulls for the optional fields", async () => {
    await ptySpawn({ sessionId: "s1", cols: 80, rows: 24 });
    expect(invokeMock).toHaveBeenCalledWith("pty_spawn", {
      sessionId: "s1",
      shell: null,
      args: null,
      cwd: null,
      cols: 80,
      rows: 24,
    });
  });

  it("forwards write/resize/kill", async () => {
    await ptyWrite("s1", "ls\n");
    await ptyResize("s1", 100, 40);
    await ptyKill("s1");
    expect(invokeMock).toHaveBeenCalledWith("pty_write", { sessionId: "s1", data: "ls\n" });
    expect(invokeMock).toHaveBeenCalledWith("pty_resize", { sessionId: "s1", cols: 100, rows: 40 });
    expect(invokeMock).toHaveBeenCalledWith("pty_kill", { sessionId: "s1" });
  });
});

describe("ptyCwd", () => {
  it("returns the backend cwd", async () => {
    invokeMock.mockResolvedValue("/tmp");
    await expect(ptyCwd("s1")).resolves.toBe("/tmp");
  });

  it("falls back to null when the command rejects", async () => {
    invokeMock.mockRejectedValueOnce(new Error("nope"));
    await expect(ptyCwd("s1")).resolves.toBeNull();
  });

  it("falls back to null when the lookup is slow (timeout)", async () => {
    vi.useFakeTimers();
    invokeMock.mockReturnValue(new Promise(() => {})); // never resolves
    const pending = ptyCwd("s1", 600);
    vi.advanceTimersByTime(600);
    await expect(pending).resolves.toBeNull();
    vi.useRealTimers();
  });
});

describe("event subscriptions", () => {
  afterEach(() => vi.useRealTimers());

  it("subscribes to the per-session output channel and decodes base64", async () => {
    let captured: ((event: { payload: string }) => void) | undefined;
    listenMock.mockImplementation((_name, handler) => {
      captured = handler as (event: { payload: string }) => void;
      return Promise.resolve(() => {});
    });
    const received: Uint8Array[] = [];
    await onPtyOutput("s1", (bytes) => received.push(bytes));
    expect(listenMock).toHaveBeenCalledWith("pty://output/s1", expect.any(Function));

    captured?.({ payload: btoa("hi") });
    expect(Array.from(received[0])).toEqual([104, 105]); // "hi"
  });

  it("subscribes to the per-session exit channel", async () => {
    await onPtyExit("s1", () => {});
    expect(listenMock).toHaveBeenCalledWith("pty://exit/s1", expect.any(Function));
  });
});
