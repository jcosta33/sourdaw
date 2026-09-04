export const externalLatencyRegistry = new Map<string, number>();

/**
 * Frames the native host measures for its own plugin round trip, at the engine
 * rate that device's plugin was activated with.
 *
 * It is no longer a term in Web Audio's plugin-delay compensation (#3564): the
 * native engine hosts and sounds the plugin, and what stands in its place in the
 * Web Audio chain is a pass-through that delays nothing. The figure is still
 * reported and still recorded, and it is cleared with the reported-latency map
 * it sits beside — an entry surviving its device would describe a plugin that is
 * no longer loaded, under an id that does not recur.
 *
 * Temporary, with the reporting chain that fills it: retiring it means retiring
 * `activateExternalPlugin`'s frames callback and the native attach report's own
 * `bridge_round_trip_frames` field, which is a change to the engine protocol
 * rather than to this map.
 */
export const externalBridgeRoundTripFrames = new Map<string, number>();

/**
 * Drop every reported-latency entry. Called from the public resetAudioGraph()
 * project-reset path after the live engine graph is reset: without it the Map
 * accumulates one entry per latency-reporting device across project switches and
 * never shrinks, since the per-device clearReportedLatency only runs when a
 * device's destroy() fires and device ids do not recur across projects.
 */
export function clearAllReportedLatency(): void {
    externalLatencyRegistry.clear();
    externalBridgeRoundTripFrames.clear();
}
