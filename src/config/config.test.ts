import { describe, expect, it } from "vitest";

import { activeProfile, type ProfileConfig, type TerminalConfig } from "./config";

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

describe("activeProfile", () => {
  it("returns the profile named by active_profile_id", () => {
    const state = config("night", profile("day"), profile("night", { opacity: 0.5 }));
    expect(activeProfile(state).id).toBe("night");
    expect(activeProfile(state).opacity).toBe(0.5);
  });

  it("falls back to the first profile when the active id is stale", () => {
    const state = config("ghost", profile("day"), profile("night"));
    expect(activeProfile(state).id).toBe("day");
  });
});
