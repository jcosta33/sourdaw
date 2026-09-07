/**
 * Instance ids whose saved state chunk the native plugin REJECTED at activation:
 * the instance stays loaded, but what it now reports over get-state is its own
 * defaults — not the user's data (Decision 0003 — never overwrite saved plugin
 * state on instantiation failure).
 *
 * While a failure stands unresolved here, state capture
 * (`captureExternalPluginStates`) preserves the stored project chunk for the
 * slot instead of committing what the instance currently reports. The marker is
 * runtime isolation state, never project truth, and it resolves only when
 * authoritative state exists again: a later restore of the same instance
 * succeeds, or an explicit `setExternalPluginState` deliberately replaces the
 * chunk. Reading plugin state never clears it.
 */
export const externalPluginRestoreFailures = new Set<string>();

/**
 * Instance ids whose failed restore already warned the user (via the save
 * path's notification), so the warning fires exactly once per failure episode
 * rather than on every autosave tick. Every marker-resolve site — restore
 * success, explicit replacement acceptance, unload, graph teardown — drops the
 * instance from here too, so a resolved-then-refailed instance warns again.
 */
export const warnedExternalPluginRestoreFailures = new Set<string>();
