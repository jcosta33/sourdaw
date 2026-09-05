export const externalLatencyRegistry = new Map<string, number>();

/**
 * Drop every reported-latency entry. Called from the public resetAudioGraph()
 * project-reset path after the live engine graph is reset: without it the Map
 * accumulates one entry per latency-reporting device across project switches and
 * never shrinks, since the per-device clearReportedLatency only runs when a
 * device's destroy() fires and device ids do not recur across projects.
 */
export function clearAllReportedLatency(): void {
    externalLatencyRegistry.clear();
}
