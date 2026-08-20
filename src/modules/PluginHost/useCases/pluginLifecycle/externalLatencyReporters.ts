/**
 * Latency sinks for live native plugin instances, keyed by plugin instance id.
 *
 * Activation registers the caller's sink here; `watchExternalPluginLatency`
 * dispatches every runtime latency change the native host pushes to the sink for
 * that instance. Keeping the sinks in one map is what lets a single
 * `plugin-latency-changed` subscription serve every loaded plugin — the native
 * event is a broadcast, so one listener per instance would hand every listener
 * every other plugin's changes.
 *
 * Values are milliseconds; the host converts at the plugin's activation sample
 * rate because this side does not share that clock.
 *
 * Ephemeral runtime state, not project truth. Cleared with the activation guard
 * set when the audio graph is torn down.
 */
export const externalLatencyReporters = new Map<string, (latencyMs: number) => void>();
