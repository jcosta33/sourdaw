import { createHmrPersistentState } from '#/utils/HMR/createHmrPersistentState';

// 2^19 floats = 524 288 samples ~= 10.9 s @ 48 kHz.
// The OPFS worker drains every 50 ms (~2 400 samples) so the ring stays nearly
// empty under normal conditions. The extra headroom covers transient stalls.
const RING_FLOATS = 524_288;

export const SAB_BYTES = 4 + RING_FLOATS * Float32Array.BYTES_PER_ELEMENT;

export const STOP_FLUSH_TIMEOUT_MS = 5_000;

export type RecordingSession = {
    trackId: string;
    mediaStream: MediaStream | null;
    sourceNode: MediaStreamAudioSourceNode | null;
    recordingNode: AudioWorkletNode | null;
    recordingWorker: Worker | null;
    onRecordingComplete: ((buffer: AudioBuffer) => void) | null;
    stopFlushTimer: ReturnType<typeof setTimeout> | null;
};

export const activeSessions = createHmrPersistentState<Map<string, RecordingSession>>(
    'audioRecorder.activeSessions',
    () => new Map()
);

export const sharedStreamState = createHmrPersistentState<{
    stream: MediaStream | null;
    usageCount: number;
}>('audioRecorder.sharedStreamState', () => ({
    stream: null,
    usageCount: 0,
}));
