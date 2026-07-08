import type { ProfileConfig, TerminalConfig } from "../config/config";

/**
 * Pure, immutable reducers over {@link TerminalConfig}'s profile list — the
 * same shape as {@link ../core/tabs}: every function returns a new config,
 * never mutates, and the caller supplies new ids. The result is exactly what
 * gets handed to `saveConfig`.
 *
 * Invariant preserved throughout: `profiles` is never emptied and
 * `active_profile_id` always names a profile in the list.
 */

/** Append a profile. Does not change which profile is active. */
export function addProfile(config: TerminalConfig, profile: ProfileConfig): TerminalConfig {
  return { ...config, profiles: [...config.profiles, profile] };
}

/**
 * Copy an existing profile's style under a new id/name and append it. Unknown
 * source ids are ignored (returns the config unchanged).
 */
export function duplicateProfile(
  config: TerminalConfig,
  sourceId: string,
  newId: string,
  newName: string,
): TerminalConfig {
  const source = config.profiles.find((p) => p.id === sourceId);
  if (!source) {
    return config;
  }
  return addProfile(config, { ...source, id: newId, name: newName });
}

/** Patch the fields of the profile with `id`; its id is always preserved. */
export function updateProfile(
  config: TerminalConfig,
  id: string,
  patch: Partial<Omit<ProfileConfig, "id">>,
): TerminalConfig {
  return {
    ...config,
    profiles: config.profiles.map((p) => (p.id === id ? { ...p, ...patch, id: p.id } : p)),
  };
}

/** Rename a profile (convenience over {@link updateProfile}). */
export function renameProfile(config: TerminalConfig, id: string, name: string): TerminalConfig {
  return updateProfile(config, id, { name });
}

/** Make a profile active. Unknown ids are ignored. */
export function setActiveProfile(config: TerminalConfig, id: string): TerminalConfig {
  if (!config.profiles.some((p) => p.id === id)) {
    return config;
  }
  return { ...config, active_profile_id: id };
}

/**
 * Remove a profile. The last profile can't be removed (a config must always
 * keep at least one). If the removed profile was active, its right neighbor
 * becomes active — mirroring tab-close semantics.
 */
export function removeProfile(config: TerminalConfig, id: string): TerminalConfig {
  if (config.profiles.length <= 1) {
    return config;
  }
  const index = config.profiles.findIndex((p) => p.id === id);
  if (index === -1) {
    return config;
  }
  const profiles = config.profiles.filter((p) => p.id !== id);
  if (config.active_profile_id !== id) {
    return { ...config, profiles };
  }
  const nextActive = profiles[index] ?? profiles[profiles.length - 1];
  return { ...config, profiles, active_profile_id: nextActive.id };
}
