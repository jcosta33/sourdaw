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
import { audioEngine } from '../createWebAudioEngine';
import { getSelectedInputId } from '../../useCases/audioDeviceSelection/getSelectedInputId';
import { audioRecordingStore } from '../../stores/audioRecordingStore';

export { audioRecordingStore };
export type { AudioRecordingState } from '../../stores/audioRecordingStore';

// ── Ring buffer sizing ────────────────────────────────────────────────────────
// 2^19 floats = 524 288 samples ≈ 10.9 s @ 48 kHz.
// The OPFS worker drains every 50 ms (~2 400 samples) so the ring stays nearly
// empty under normal conditions. The extra headroom covers transient stalls.
const RING_FLOATS = 524_288;
const SAB_BYTES = 4 + RING_FLOATS * Float32Array.BYTES_PER_ELEMENT; // 4-byte writeHead + ring

// §35.1 — Coalesce 5 module-level mutables into a single holder so the
// recording session lives behind one named handle.
const recordingSession: {
    mediaStream: MediaStream | null;
    sourceNode: MediaStreamAudioSourceNode | null;
    recordingNode: AudioWorkletNode | null;
    recordingWorker: Worker | null;
    onRecordingComplete: ((buffer: AudioBuffer) => void) | null;
} = {
    mediaStream: null,
    sourceNode: null,
    recordingNode: null,
    recordingWorker: null,
    onRecordingComplete: null,
};

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
        for (const t of stream.getTracks()) {t.stop();}
        audioRecordingStore.set({ ...audioRecordingStore.value!, micPermissionGranted: true });
        return true;
    } catch {
        audioRecordingStore.set({ ...audioRecordingStore.value!, micPermissionGranted: false });
        return false;
    }
}

export const startAudioRecording = inject({ logger })(
    ({ logger }) =>
        (async function startAudioRecording(
            trackId: string,
            onComplete: (buffer: AudioBuffer) => void,
            inputId?: string | null,
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
                recordingSession.recordingWorker = new Worker(new URL('../../workers/recordingWorker.ts', import.meta.url), {
                    type: 'module',
                });

                // Wire up the PCM-complete handler before sending 'start'.
                recordingSession.recordingWorker.onmessage = ({ data }: MessageEvent): void => {
                    const msg = data as
                        | { type: 'ready' }
                        | { type: 'pcm'; samples: Float32Array; sampleRate: number }
                        | { type: 'error'; message: string };

                    if (msg.type === 'ready') {
                        // Both sides are initialised — begin capture.
                        recordingSession.recordingNode?.port.postMessage({ type: 'start' });
                        recordingSession.recordingWorker?.postMessage({ type: 'start' });
                        audioRecordingStore.set({ ...audioRecordingStore.value!, isRecording: true });
                    } else if (msg.type === 'pcm') {
                        // Worker has flushed OPFS → build AudioBuffer on the main thread.
                        buildAndDeliver(msg.samples, msg.sampleRate, ctx);
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
        })
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

function buildAndDeliver(samples: Float32Array, sampleRate: number, ctx: AudioContext): void {
    const cb = recordingSession.onRecordingComplete;
    recordingSession.onRecordingComplete = null;

    if (!cb || samples.length === 0) {
        terminateWorker();
        return;
    }

    const buffer = ctx.createBuffer(1, samples.length, sampleRate);
    buffer.getChannelData(0).set(samples);
    cb(buffer);

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
