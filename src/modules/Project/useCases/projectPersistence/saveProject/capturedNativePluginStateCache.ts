/**
 * Per-instance record of the last opaque state chunk THIS peer read from its own
 * plugin host during a capture, keyed by `externalInstanceId`.
 *
 * `captureExternalPluginStates` compares a fresh host read against this cache to
 * decide whether the LOCAL plugin actually changed — independently of what a
 * collaboration sync wrote into project truth. Without it, a remote peer's chunk
 * sitting in the store would make every autosave tick re-commit the local chunk,
 * and the peer would do the same in reverse: two peers alternately overwriting
 * each other's plugin state forever (collab ping-pong).
 *
 * Ephemeral in-memory dedup state, not project truth. It is naturally reset on
 * reload; stale entries for retired instance ids are harmless because instance
 * ids are unique per instance.
 */
export const capturedNativePluginStateCache = new Map<string, string>();
