import { describe, expect, it } from "vitest";

import { parseSession, SESSION_VERSION, type SessionSnapshot } from "./session";

const valid: SessionSnapshot = {
  version: SESSION_VERSION,
  activeTabIndex: 1,
  tabs: [
    {
      title: "One",
      orientation: "vertical",
      activePaneIndex: 0,
      panes: [
        { cwd: "/a", name: "api" },
        { cwd: "/b", name: null },
      ],
    },
    {
      title: "Two",
      orientation: "horizontal",
      activePaneIndex: 0,
      panes: [{ cwd: null, name: null }],
    },
  ],
};

describe("parseSession", () => {
  it("round-trips a valid snapshot", () => {
    const parsed = parseSession(JSON.parse(JSON.stringify(valid)));
    expect(parsed).toEqual(valid);
  });

  it("rejects a null / non-object blob", () => {
    expect(parseSession(null)).toBeNull();
    expect(parseSession("nope")).toBeNull();
  });

  it("rejects a version mismatch", () => {
    expect(parseSession({ ...valid, version: 99 })).toBeNull();
  });

  it("rejects a snapshot with no usable tabs", () => {
    expect(parseSession({ version: SESSION_VERSION, activeTabIndex: 0, tabs: [] })).toBeNull();
    expect(
      parseSession({ version: SESSION_VERSION, activeTabIndex: 0, tabs: [{ panes: [] }] }),
    ).toBeNull();
  });

  it("clamps an out-of-range activeTabIndex", () => {
    const parsed = parseSession({ ...valid, activeTabIndex: 99 });
    expect(parsed?.activeTabIndex).toBe(1);
  });

  it("clamps an out-of-range activePaneIndex", () => {
    const parsed = parseSession({
      version: SESSION_VERSION,
      activeTabIndex: 0,
      tabs: [{ title: "x", orientation: "vertical", activePaneIndex: 42, panes: [{ cwd: "/a" }] }],
    });
    expect(parsed?.tabs[0].activePaneIndex).toBe(0);
  });

  it("truncates a tab to at most 4 panes", () => {
    const parsed = parseSession({
      version: SESSION_VERSION,
      activeTabIndex: 0,
      tabs: [
        {
          title: "x",
          orientation: "vertical",
          activePaneIndex: 0,
          panes: [{ cwd: "/1" }, { cwd: "/2" }, { cwd: "/3" }, { cwd: "/4" }, { cwd: "/5" }],
        },
      ],
    });
    expect(parsed?.tabs[0].panes).toHaveLength(4);
  });

  it("defaults missing fields (title, orientation, cwd, name)", () => {
    const parsed = parseSession({
      version: SESSION_VERSION,
      activeTabIndex: 0,
      tabs: [{ panes: [{}] }],
    });
    expect(parsed?.tabs[0].title).toBe("Terminal");
    expect(parsed?.tabs[0].orientation).toBe("vertical");
    expect(parsed?.tabs[0].panes[0].cwd).toBeNull();
    expect(parsed?.tabs[0].panes[0].name).toBeNull();
  });

  it("keeps a pane name when present", () => {
    const parsed = parseSession({
      version: SESSION_VERSION,
      activeTabIndex: 0,
      tabs: [{ panes: [{ cwd: "/x", name: "worker" }] }],
    });
    expect(parsed?.tabs[0].panes[0].name).toBe("worker");
  });
});
