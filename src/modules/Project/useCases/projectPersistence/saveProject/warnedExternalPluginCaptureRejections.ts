/**
 * Instance ids whose failed state capture already warned the user (via the save
 * path's notification), so the warning fires once per failed-capture episode
 * rather than on every autosave tick. A later capture the command machinery
 * accepts for the instance ends the episode and clears the entry, so a fresh
 * failure warns again.
 *
 * Ephemeral in-memory dedup state, not project truth; stale entries for retired
 * instance ids are harmless because instance ids are unique per instance.
 */
export const warnedExternalPluginCaptureRejections = new Set<string>();
