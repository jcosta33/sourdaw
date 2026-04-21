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
import { getSelectedInputId } from '../../useCases/audioDeviceSelection/getSelectedInputId';
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
    mediaStream: MediaStream | null;
    sourceNode: MediaStreamAudioSourceNode | null;
    recordingNode: AudioWorkletNode | null;
    recordingWorker: Worker | null;
    onRecordingComplete: ((buffer: AudioBuffer) => void) | null;
};

// §35.1 originally coalesced 5 loose `let`s into this named holder.
// §147.1 promotes the holder to HMR-persistent state because the OPFS
// recording worker's `onmessage` handler closes over the same object:
// if Vite replaces the module mid-recording, a fresh holder would leave
// the worker's closure pointing at orphaned state, and the final PCM
// buffer would land on an `onRecordingComplete` that's already been
// reset to `null`. In dev, `createHmrPersistentState` stashes the
// session on `import.meta.hot.data` so the new module instance reads
// back the same object the old one was writing to. In prod the call
// collapses to a one-shot initializer with no runtime overhead.
const recordingSession = createHmrPersistentState<RecordingSession>('audioRecorder.recordingSession', () => ({
    mediaStream: null,
    sourceNode: null,
    recordingNode: null,
    recordingWorker: null,
    onRecordingComplete: null,
}));

/**
 * Pre-request microphone permission so the browser prompt fires on page load
 * rather than at first-record time. The stream is stopped immediately.
 */
export async function requestMicPermission(): Promise<boolean> {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({
            audio: {
                echoCancellation: false,
                noiseSuppression: false,
                autoGainControl: false,
            },
        });
        for (const t of stream.getTracks()) {
            t.stop();
        }
        audioRecordingStore.set({ ...audioRecordingStore.value!, micPermissionGranted: true });
        return true;
    } catch {
        audioRecordingStore.set({ ...audioRecordingStore.value!, micPermissionGranted: false });
        return false;
    }
}

export const startAudioRecording = inject({ logger })(
    ({ logger }) =>
        async function startAudioRecording(
            trackId: string,
            onComplete: (buffer: AudioBuffer) => void,
            inputId?: string | null
        ): Promise<boolean> {
            try {
                const selectedInputId = inputId ?? getSelectedInputId();
                const audioConstraints: MediaTrackConstraints = {
                    echoCancellation: false,
                    noiseSuppression: false,
                    autoGainControl: false,
                };
                if (selectedInputId) {
                    audioConstraints.deviceId = { exact: selectedInputId };
                }

                recordingSession.mediaStream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints });

                const ctx = audioEngine.context;
                recordingSession.sourceNode = ctx.createMediaStreamSource(recordingSession.mediaStream);

                // Monitor via the track strip (same as before).
                const strip = audioEngine.ensureTrackStrip(trackId);
                recordingSession.sourceNode.connect(strip.gainNode);

                recordingSession.onRecordingComplete = onComplete;

                // ── SAB ring ─────────────────────────────────────────────────────────
                const sab = new SharedArrayBuffer(SAB_BYTES);

                // ── AudioWorkletNode (recording-processor) ───────────────────────────
                // numberOfOutputs: 0 — sink node, no destination connection needed.
                recordingSession.recordingNode = new AudioWorkletNode(ctx, 'recording-processor', {
                    numberOfInputs: 1,
                    numberOfOutputs: 0,
                    channelCount: 1,
                    channelCountMode: 'explicit',
                    channelInterpretation: 'discrete',
                });
                recordingSession.recordingNode.port.postMessage({ type: 'init', sab });
                recordingSession.sourceNode.connect(recordingSession.recordingNode);

                // ── OPFS Worker ──────────────────────────────────────────────────────
                recordingSession.recordingWorker = new Worker(
                    new URL('../../workers/recordingWorker.ts', import.meta.url),
                    {
                        type: 'module',
                    }
                );

                // Wire up the PCM-complete handler before sending 'start'.
                recordingSession.recordingWorker.onmessage = ({ data }: MessageEvent): void => {
                    const msg = data as
                        | { type: 'ready' }
                        | { type: 'wav'; buffer: ArrayBuffer }
                        | { type: 'error'; message: string };

                    if (msg.type === 'ready') {
                        // Both sides are initialised — begin capture.
                        recordingSession.recordingNode?.port.postMessage({ type: 'start' });
                        recordingSession.recordingWorker?.postMessage({ type: 'start' });
                        audioRecordingStore.set({ ...audioRecordingStore.value!, isRecording: true });
                    } else if (msg.type === 'wav') {
                        // Worker has flushed OPFS → decode WAV on the main thread.
                        void decodeAndDeliver(msg.buffer, ctx);
                    } else if (msg.type === 'error') {
                        logger.error(new Error(`Recording worker error: ${msg.message}`));
                        cleanupNodes();
                        audioRecordingStore.set({ ...audioRecordingStore.value!, isRecording: false });
                    }
                };

                recordingSession.recordingWorker.onerror = (e): void => {
                    logger.error(new Error('Recording worker crashed', { cause: e }));
                    cleanupNodes();
                    audioRecordingStore.set({ ...audioRecordingStore.value!, isRecording: false });
                };

                recordingSession.recordingWorker.postMessage({ type: 'init', sab, sampleRate: ctx.sampleRate });

                return true;
            } catch (error) {
                logger.error(new Error('Failed to start recording', { cause: error }));
                cleanupNodes();
                return false;
            }
        }
);

export function stopAudioRecording(): void {
    // Tell the worklet to stop writing — it will ack with 'stopped' (ignored).
    recordingSession.recordingNode?.port.postMessage({ type: 'stop' });

    // Tell the OPFS worker to do a final drain and send back the PCM.
    // The 'pcm' handler in startAudioRecording delivers the AudioBuffer.
    recordingSession.recordingWorker?.postMessage({ type: 'stop' });

    // Disconnect audio nodes immediately so monitoring stops.
    cleanupNodes();

    audioRecordingStore.set({ ...audioRecordingStore.value!, isRecording: false });
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function decodeAndDeliver(wavBuffer: ArrayBuffer, ctx: AudioContext): Promise<void> {
    const cb = recordingSession.onRecordingComplete;
    recordingSession.onRecordingComplete = null;

    if (!cb || wavBuffer.byteLength <= 44) {
        terminateWorker();
        return;
    }

    try {
        const buffer = await ctx.decodeAudioData(wavBuffer);
        cb(buffer);
    } catch (error) {
        logger.error(new Error('Failed to decode recorded audio', { cause: error }));
    }

    terminateWorker();
}

function terminateWorker(): void {
    recordingSession.recordingWorker?.terminate();
    recordingSession.recordingWorker = null;
}

function cleanupNodes(): void {
    if (recordingSession.recordingNode) {
        recordingSession.recordingNode.disconnect();
        recordingSession.recordingNode = null;
    }
    if (recordingSession.sourceNode) {
        recordingSession.sourceNode.disconnect();
        recordingSession.sourceNode = null;
    }
    if (recordingSession.mediaStream) {
        for (const t of recordingSession.mediaStream.getTracks()) {
            t.stop();
        }
        recordingSession.mediaStream = null;
    }
}
