import { describe, expect, it } from "vitest";

import type { ProfileConfig, TerminalConfig } from "../config/config";
import {
  addProfile,
  duplicateProfile,
  removeProfile,
  renameProfile,
  setActiveProfile,
  updateProfile,
} from "./profiles";

const profile = (id: string, over: Partial<ProfileConfig> = {}): ProfileConfig => ({
  id,
  name: id,
  opacity: 0.82,
  blur_material: "hud",
  font_family: "JetBrains Mono",
  font_size: 14,
  cursor_blink: true,
  palette: {} as ProfileConfig["palette"],
  ...over,
});

const config = (activeId: string, ...profiles: ProfileConfig[]): TerminalConfig => ({
  active_profile_id: activeId,
  watermark: true,
  show_banner: true,
  default_shell: null,
  scrollback: 10_000,
  profiles,
});

const ids = (c: TerminalConfig) => c.profiles.map((p) => p.id);

describe("addProfile", () => {
  it("appends without changing the active profile", () => {
    const next = addProfile(config("a", profile("a")), profile("b"));
    expect(ids(next)).toEqual(["a", "b"]);
    expect(next.active_profile_id).toBe("a");
  });
});

describe("duplicateProfile", () => {
  it("clones the source style under a new id and name", () => {
    const base = config("a", profile("a", { font_size: 20, opacity: 0.4 }));
    const next = duplicateProfile(base, "a", "a-copy", "A copy");
    expect(ids(next)).toEqual(["a", "a-copy"]);
    const copy = next.profiles[1];
    expect(copy.name).toBe("A copy");
    expect(copy.font_size).toBe(20);
    expect(copy.opacity).toBe(0.4);
  });

  it("ignores an unknown source id", () => {
    const base = config("a", profile("a"));
    expect(duplicateProfile(base, "ghost", "x", "X")).toEqual(base);
  });
});

describe("updateProfile", () => {
  it("patches only the targeted profile and keeps its id", () => {
    const base = config("a", profile("a"), profile("b"));
    const next = updateProfile(base, "b", { font_size: 18 });
    expect(next.profiles[0].font_size).toBe(14);
    expect(next.profiles[1].font_size).toBe(18);
    expect(next.profiles[1].id).toBe("b");
  });

  it("cannot overwrite the id via patch", () => {
    const base = config("a", profile("a"));
    const next = updateProfile(base, "a", { name: "renamed" } as Partial<Omit<ProfileConfig, "id">>);
    expect(next.profiles[0].id).toBe("a");
    expect(next.profiles[0].name).toBe("renamed");
  });
});

describe("renameProfile", () => {
  it("changes only the name", () => {
    const next = renameProfile(config("a", profile("a")), "a", "Night");
    expect(next.profiles[0].name).toBe("Night");
  });
});

describe("setActiveProfile", () => {
  it("switches the active id when the profile exists", () => {
    const next = setActiveProfile(config("a", profile("a"), profile("b")), "b");
    expect(next.active_profile_id).toBe("b");
  });

  it("ignores unknown ids", () => {
    const base = config("a", profile("a"));
    expect(setActiveProfile(base, "ghost")).toEqual(base);
  });
});

describe("removeProfile", () => {
  it("refuses to remove the last profile", () => {
    const base = config("a", profile("a"));
    expect(removeProfile(base, "a")).toEqual(base);
  });

  it("removes an inactive profile and keeps the active one", () => {
    const base = config("b", profile("a"), profile("b"), profile("c"));
    const next = removeProfile(base, "a");
    expect(ids(next)).toEqual(["b", "c"]);
    expect(next.active_profile_id).toBe("b");
  });

  it("activates the right neighbor when the active profile is removed", () => {
    const base = config("b", profile("a"), profile("b"), profile("c"));
    const next = removeProfile(base, "b");
    expect(ids(next)).toEqual(["a", "c"]);
    expect(next.active_profile_id).toBe("c");
  });

  it("falls back to the last profile when removing the active tail", () => {
    const base = config("c", profile("a"), profile("b"), profile("c"));
    const next = removeProfile(base, "c");
    expect(ids(next)).toEqual(["a", "b"]);
    expect(next.active_profile_id).toBe("b");
  });

  it("ignores unknown ids", () => {
    const base = config("a", profile("a"), profile("b"));
    expect(removeProfile(base, "ghost")).toEqual(base);
  });
});
