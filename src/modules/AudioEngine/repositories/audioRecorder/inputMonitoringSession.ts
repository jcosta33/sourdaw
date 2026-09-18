import { createHmrPersistentState } from '#/utils/HMR/createHmrPersistentState';

type InputMonitoringSession = {
    monitorStream: MediaStream | null;
    monitorSource: MediaStreamAudioSourceNode | null;
    /** Per-track listening edges: trackId → the strip input the shared source feeds. */
    monitorEdges: Map<string, AudioNode>;
    /** The one in-flight capture request every interested track currently shares. */
    pendingRequest: Promise<MediaStream> | null;
    /** Tracks waiting for an edge from `pendingRequest`; ownership is checked at settlement. */
    pendingOwners: Set<string>;
};

export const inputMonitoringSession = createHmrPersistentState<InputMonitoringSession>(
    // v2: the shape gained per-track edges and pending-capture bookkeeping; a dev
    // session holding the v1 object would come back without the Map and crash.
    'audioEngine.inputMonitoring.v2',
    () => ({
        monitorStream: null,
        monitorSource: null,
        monitorEdges: new Map(),
        pendingRequest: null,
        pendingOwners: new Set(),
    })
);
