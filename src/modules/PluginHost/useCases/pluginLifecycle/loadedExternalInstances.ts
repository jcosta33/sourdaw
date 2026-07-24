/**
 * Instance ids of native plugins already instantiated in the current live audio
 * graph generation.
 *
 * Activation is idempotent against this set: repeated strip rebuilds — every
 * `ensureTrackStrips` from project open, Play, and record — must not re-issue a
 * load or restore IPC for an instance that is already live. The set is cleared
 * when the audio graph is torn down (project open/switch) so the next generation
 * re-activates persisted native plugins.
 *
 * Ephemeral runtime state, not project truth.
 */
export const loadedExternalInstances = new Set<string>();
