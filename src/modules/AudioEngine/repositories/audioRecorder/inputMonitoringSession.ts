import { createHmrPersistentState } from '#/utils/HMR/createHmrPersistentState';

/**
 * The selected input a capture serves. `null` is its own key: "no explicit
 * device" is the global/default selection, never the same capture as a track
 * that named a device.
 */
export type MonitorCaptureKey = string | null;

/** One settled capture: the device stream and the source node feeding its edges. */
export type MonitorCapture = {
    monitorStream: MediaStream;
    monitorSource: MediaStreamAudioSourceNode;
    /** Per-track listening edges: trackId → the strip input this capture's source feeds. */
    monitorEdges: Map<string, AudioNode>;
};

type InputMonitoringSession = {
    /** Settled captures keyed by selected input; one independent capture per key. */
    captures: Map<MonitorCaptureKey, MonitorCapture>;
    /** Which key each track currently monitors, so an input change releases the old edge. */
    trackKeys: Map<string, MonitorCaptureKey>;
    /** Every in-flight acquisition keyed like its eventual capture, deduped per key. */
    pendingRequests: Map<MonitorCaptureKey, Promise<MediaStream>>;
};

export const inputMonitoringSession = createHmrPersistentState<InputMonitoringSession>(
    // v3: captures are keyed by selected input and a track can hold several keys
    // across its lifetime; a dev session holding the v2 singleton object would
    // come back without the keyed maps and hand one track another's source.
    'audioEngine.inputMonitoring.v3',
    () => ({
        captures: new Map(),
        trackKeys: new Map(),
        pendingRequests: new Map(),
    })
);

/**
 * Every track interested in one key right now: the edge owners of its settled
 * capture plus the tracks still waiting on its in-flight acquisition.
 */
export function monitorOwnersFor(key: MonitorCaptureKey): Set<string> {
    const owners = new Set<string>(inputMonitoringSession.captures.get(key)?.monitorEdges.keys());
    for (const [trackId, monitoredKey] of inputMonitoringSession.trackKeys) {
        if (monitoredKey === key) {
            owners.add(trackId);
        }
    }
    return owners;
}
