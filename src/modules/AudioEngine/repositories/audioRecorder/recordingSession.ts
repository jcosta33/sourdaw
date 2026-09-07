import { createHmrPersistentState } from '#/utils/HMR/createHmrPersistentState';

import { RECORDING_RING_CONTROL_BYTES } from '../../models/RecordingRingProtocol';

// 2^19 floats = 524 288 samples ~= 10.9 s @ 48 kHz.
// The OPFS worker drains every 50 ms (~2 400 samples) so the ring stays nearly
// empty under normal conditions. The extra headroom covers transient stalls.
const RING_FLOATS = 524_288;

export const SAB_BYTES = RECORDING_RING_CONTROL_BYTES + RING_FLOATS * Float32Array.BYTES_PER_ELEMENT;

export const STOP_FLUSH_TIMEOUT_MS = 5_000;

export type RecordingSession = {
    trackId: string;
    mediaStream: MediaStream | null;
    sourceNode: MediaStreamAudioSourceNode | null;
    recordingNode: AudioWorkletNode | null;
    recordingWorker: Worker | null;
    status: 'starting' | 'recording' | 'stopping';
    onRecordingComplete: ((buffer: AudioBuffer) => void) | null;
    stopFlushTimer: ReturnType<typeof setTimeout> | null;
    producerStopAcknowledged: boolean;
};

export type RecordingStopWaiter = {
    resolve: () => void;
    trackIds: ReadonlySet<string>;
};

export const activeSessions = createHmrPersistentState<Map<string, RecordingSession>>(
    'audioRecorder.activeSessions',
    () => new Map()
);

export const sharedStreamState = createHmrPersistentState<{
    stream: MediaStream | null;
    pendingRequest: Promise<MediaStream> | null;
    streamUsage: Map<MediaStream, number>;
}>(
    // v2: the shape gained pendingRequest and per-stream usage; a dev session
    // holding the v1 object would come back without streamUsage and crash.
    'audioRecorder.sharedStreamState.v2',
    () => ({
        stream: null,
        pendingRequest: null,
        streamUsage: new Map(),
    })
);

export const recordingLifecycleState = createHmrPersistentState<{
    startGeneration: number;
    stopWaiters: Set<RecordingStopWaiter>;
}>('audioRecorder.lifecycle', () => ({
    startGeneration: 0,
    stopWaiters: new Set(),
}));
