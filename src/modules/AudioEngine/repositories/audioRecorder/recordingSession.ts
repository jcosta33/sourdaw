import { createHmrPersistentState } from '#/utils/HMR/createHmrPersistentState';

import { RECORDING_RING_CONTROL_BYTES } from '../../models/RecordingRingProtocol';

// 2^19 floats = 524 288 samples ~= 10.9 s @ 48 kHz.
// The OPFS worker drains every 50 ms (~2 400 samples) so the ring stays nearly
// empty under normal conditions. The extra headroom covers transient stalls.
const RING_FLOATS = 524_288;

export const SAB_BYTES = RECORDING_RING_CONTROL_BYTES + RING_FLOATS * Float32Array.BYTES_PER_ELEMENT;

export const STOP_FLUSH_TIMEOUT_MS = 5_000;

export type RecordingResult =
    | { kind: 'completed'; buffer: AudioBuffer; sampleZeroContextFrame: number; sampleRate: number }
    | {
          kind: 'failed';
          reason:
              | 'worker-error'
              | 'worker-crash'
              | 'flush-timeout'
              | 'empty-wav'
              | 'invalid-capture-metadata'
              | 'decode-failed';
      };

export type RecordingTerminalCallback = (result: RecordingResult) => void;

export type RecordingSession = {
    trackId: string;
    mediaStream: MediaStream | null;
    sourceNode: MediaStreamAudioSourceNode | null;
    recordingNode: AudioWorkletNode | null;
    recordingWorker: Worker | null;
    captureSampleRate: number;
    status: 'starting' | 'recording' | 'stopping';
    onTerminal: RecordingTerminalCallback | null;
    decodePending: boolean;
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
    /** One cached stream per requested input key — distinct devices never share a stream (#3773). */
    streams: Map<string, MediaStream>;
    pendingRequests: Map<string, Promise<MediaStream>>;
    streamUsage: Map<MediaStream, number>;
}>(
    // v3: the single-slot cache became per-input maps when recording started
    // honoring the track's input selection; a dev session holding the v2
    // object would come back without them and share the wrong microphone.
    'audioRecorder.sharedStreamState.v3',
    () => ({
        streams: new Map(),
        pendingRequests: new Map(),
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
