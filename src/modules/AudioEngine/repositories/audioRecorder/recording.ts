/**
 * Audio recording — start/stop microphone recording via AudioWorklet + SAB.
 *
 * Replaces the deprecated ScriptProcessorNode pipeline:
 *
 *   OLD: ScriptProcessorNode on the main thread → copies every 4096-sample block
 *        into a growing rawChunks array → concatenates on stop (UI freeze).
 *
 *   NEW: AudioWorkletNode ('recording-processor') writes 128-sample blocks into
 *        a SharedArrayBuffer ring on the audio thread (zero IPC, zero allocs).
 *        A background OPFS Worker drains the ring to a temp file every 50 ms,
 *        keeping main-thread memory flat. On stop the Worker transfers the
 *        complete Float32Array back; main thread creates the AudioBuffer.
 *
 * The processor must be registered in createWebAudioEngine.initialize() before
 * the first call to startAudioRecording.
 */

import { inject } from '#/infra/di/inject';
import { logger } from '#/infra/logger/appLogger';
import { createHmrPersistentState } from '#/utils/HMR/createHmrPersistentState';

import { audioRecordingStore } from '../../stores/audioRecordingStore';
import { audioEngine } from '../createWebAudioEngine';

export { audioRecordingStore };
export type { AudioRecordingState } from '../../stores/audioRecordingStore';

// ── Ring buffer sizing ────────────────────────────────────────────────────────
// 2^19 floats = 524 288 samples ≈ 10.9 s @ 48 kHz.
// The OPFS worker drains every 50 ms (~2 400 samples) so the ring stays nearly
// empty under normal conditions. The extra headroom covers transient stalls.
const RING_FLOATS = 524_288;
const SAB_BYTES = 4 + RING_FLOATS * Float32Array.BYTES_PER_ELEMENT; // 4-byte writeHead + ring

type RecordingSession = {
    trackId: string;
    mediaStream: MediaStream | null;
    sourceNode: MediaStreamAudioSourceNode | null;
    recordingNode: AudioWorkletNode | null;
    recordingWorker: Worker | null;
    onRecordingComplete: ((buffer: AudioBuffer) => void) | null;
    /** Guard timer armed at stop() to force teardown if the worker never flushes. */
    stopFlushTimer: ReturnType<typeof setTimeout> | null;
};

// On stop() the OPFS worker is expected to flush and post back a final `wav`
// message, which drives decode + teardown. If it never replies (a silent flush
// stall, or a worker that exits without posting), the Worker and the
// activeSessions entry would leak — and startAudioRecording early-returns on
// activeSessions.has(trackId), permanently blocking re-recording that track.
// This bound forces teardown so a stalled worker cannot wedge the track.
const STOP_FLUSH_TIMEOUT_MS = 5_000;

// Use a Map to support multi-track simultaneous recording.
const activeSessions = createHmrPersistentState<Map<string, RecordingSession>>(
    'audioRecorder.activeSessions',
    () => new Map()
);

// Keep track of the shared media stream to avoid multiple getUserMedia prompts
// when arming multiple tracks.
const sharedStreamState = createHmrPersistentState<{
    stream: MediaStream | null;
    usageCount: number;
}>('audioRecorder.sharedStreamState', () => ({
    stream: null,
    usageCount: 0,
}));

async function acquireSharedMediaStream(constraints: MediaTrackConstraints): Promise<MediaStream> {
    if (!sharedStreamState.stream) {
        sharedStreamState.stream = await navigator.mediaDevices.getUserMedia({ audio: constraints });
    }
    sharedStreamState.usageCount++;
    return sharedStreamState.stream;
}

function releaseSharedMediaStream(): void {
    if (sharedStreamState.usageCount > 0) {
        sharedStreamState.usageCount--;
    }
    if (sharedStreamState.usageCount === 0 && sharedStreamState.stream) {
        for (const track of sharedStreamState.stream.getTracks()) {
            track.stop();
        }
        sharedStreamState.stream = null;
    }
}

export const startAudioRecording = inject({ logger })(
    ({ logger }) =>
        async function startAudioRecording(
            trackId: string,
            onComplete: (buffer: AudioBuffer) => void,
            inputId: string | null = null
        ): Promise<boolean> {
            try {
                if (activeSessions.has(trackId)) {
                    logger.warn(`[startAudioRecording] Track ${trackId} is already recording.`);
                    return false;
                }

                const audioConstraints: MediaTrackConstraints = {
                    echoCancellation: false,
                    noiseSuppression: false,
                    autoGainControl: false,
                };
                if (inputId) {
                    audioConstraints.deviceId = { exact: inputId };
                }

                const mediaStream = await acquireSharedMediaStream(audioConstraints);
                const ctx = audioEngine.context;
                const sourceNode = ctx.createMediaStreamSource(mediaStream);

                // Monitor via the track strip (same as before).
                const strip = audioEngine.ensureTrackStrip(trackId);
                sourceNode.connect(strip.gainNode);

                // ── SAB ring ─────────────────────────────────────────────────────────
                const sab = new SharedArrayBuffer(SAB_BYTES);

                // ── AudioWorkletNode (recording-processor) ───────────────────────────
                const recordingNode = new AudioWorkletNode(ctx, 'recording-processor', {
                    numberOfInputs: 1,
                    numberOfOutputs: 0,
                    channelCount: 1,
                    channelCountMode: 'explicit',
                    channelInterpretation: 'discrete',
                });
                recordingNode.port.postMessage({ type: 'init', sab });
                sourceNode.connect(recordingNode);

                // ── OPFS Worker ──────────────────────────────────────────────────────
                const recordingWorker = new Worker(new URL('../../workers/recordingWorker.ts', import.meta.url), {
                    type: 'module',
                });

                const session: RecordingSession = {
                    trackId,
                    mediaStream,
                    sourceNode,
                    recordingNode,
                    recordingWorker,
                    onRecordingComplete: onComplete,
                    stopFlushTimer: null,
                };
                activeSessions.set(trackId, session);

                // Wire up the PCM-complete handler before sending 'start'.
                recordingWorker.onmessage = ({ data }: MessageEvent): void => {
                    const msg = data as
                        | { type: 'ready' }
                        | { type: 'wav'; buffer: ArrayBuffer }
                        | { type: 'error'; message: string };

                    if (msg.type === 'ready') {
                        // Both sides are initialised — begin capture.
                        recordingNode.port.postMessage({ type: 'start' });
                        recordingWorker.postMessage({ type: 'start' });
                        audioRecordingStore.set({ ...audioRecordingStore.value!, isRecording: true });
                    } else if (msg.type === 'wav') {
                        // Worker has flushed OPFS → decode WAV on the main thread.
                        void decodeAndDeliver(trackId, msg.buffer, ctx);
                    } else if (msg.type === 'error') {
                        logger.error(new Error(`Recording worker error on track ${trackId}: ${msg.message}`));
                        cleanupNode(trackId);
                        checkAllStopped();
                    }
                };

                recordingWorker.onerror = (event): void => {
                    logger.error(new Error(`Recording worker crashed on track ${trackId}`, { cause: event }));
                    cleanupNode(trackId);
                    checkAllStopped();
                };

                recordingWorker.postMessage({ type: 'init', sab, sampleRate: ctx.sampleRate });

                return true;
            } catch (error) {
                logger.error(new Error(`Failed to start recording on track ${trackId}`, { cause: error }));
                cleanupNode(trackId);
                return false;
            }
        }
);

export function stopAudioRecording(): void {
    for (const session of activeSessions.values()) {
        session.recordingNode?.port.postMessage({ type: 'stop' });
        session.recordingWorker?.postMessage({ type: 'stop' });
        cleanupNodesForSession(session);
        armStopFlushTimer(session);
    }

    audioRecordingStore.set({ ...audioRecordingStore.value!, isRecording: false });
}

// After stop() we wait for the worker's final `wav` flush, but bound the wait:
// if it never arrives, force-terminate the worker and drop the session so the
// track is not permanently blocked from re-recording.
function armStopFlushTimer(session: RecordingSession): void {
    const { trackId } = session;
    session.stopFlushTimer = setTimeout(() => {
        const stalled = activeSessions.get(trackId);
        if (!stalled) {
            return;
        }
        logger.error(
            new Error(
                `Recording worker did not flush within ${STOP_FLUSH_TIMEOUT_MS}ms on track ${trackId}; forcing teardown`
            )
        );
        stalled.onRecordingComplete = null;
        terminateWorker(stalled);
        activeSessions.delete(trackId);
        checkAllStopped();
    }, STOP_FLUSH_TIMEOUT_MS);
}

function clearStopFlushTimer(session: RecordingSession): void {
    if (session.stopFlushTimer !== null) {
        clearTimeout(session.stopFlushTimer);
        session.stopFlushTimer = null;
    }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function decodeAndDeliver(trackId: string, wavBuffer: ArrayBuffer, ctx: AudioContext): Promise<void> {
    const session = activeSessions.get(trackId);
    if (!session) {
        return;
    }

    // The worker flushed in time — cancel the stop-flush guard.
    clearStopFlushTimer(session);

    const cb = session.onRecordingComplete;
    session.onRecordingComplete = null;

    if (!cb || wavBuffer.byteLength <= 44) {
        terminateWorker(session);
        activeSessions.delete(trackId);
        checkAllStopped();
        return;
    }

    try {
        const buffer = await ctx.decodeAudioData(wavBuffer);
        cb(buffer);
    } catch (error) {
        logger.error(new Error(`Failed to decode recorded audio for track ${trackId}`, { cause: error }));
    }

    terminateWorker(session);
    activeSessions.delete(trackId);
    checkAllStopped();
}

function terminateWorker(session: RecordingSession): void {
    clearStopFlushTimer(session);
    session.recordingWorker?.terminate();
    session.recordingWorker = null;
}

function cleanupNode(trackId: string): void {
    const session = activeSessions.get(trackId);
    if (session) {
        cleanupNodesForSession(session);
        activeSessions.delete(trackId);
    }
}

function cleanupNodesForSession(session: RecordingSession): void {
    clearStopFlushTimer(session);
    if (session.recordingNode) {
        session.recordingNode.disconnect();
        session.recordingNode = null;
    }
    if (session.sourceNode) {
        session.sourceNode.disconnect();
        session.sourceNode = null;
    }
    if (session.mediaStream) {
        releaseSharedMediaStream();
        session.mediaStream = null;
    }
}

function checkAllStopped(): void {
    if (activeSessions.size === 0) {
        audioRecordingStore.set({ ...audioRecordingStore.value!, isRecording: false });
    }
}
