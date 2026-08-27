export const externalLatencyRegistry = new Map<string, number>();

/**
 * Frames the worklet↔plugin audio bridge adds for one external-plugin device,
 * at the engine rate that device's plugin was activated with.
 *
 * A bridged plugin is late by more than it reports for itself: its audio is
 * relayed to the native host over IPC, queued for the audio thread, processed,
 * and queued back. The host measures that round trip against the device period
 * it actually runs on and reports it at load — the frontend cannot derive it,
 * which is why this is a reported number and not a constant.
 *
 * Kept beside the reported-latency map rather than in one of its own so the two
 * are cleared together; an entry surviving its device is a track compensated
 * for a plugin that is no longer there.
 *
 * Temporary, with the bridge: jcosta33/sourdaw#2230 replaces the worklet relay
 * with the native graph, and this map goes with it.
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
