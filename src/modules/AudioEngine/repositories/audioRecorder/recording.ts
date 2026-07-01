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

import { audioRecordingStore } from '../../stores/audioRecordingStore';
import { audioEngine } from '../createWebAudioEngine';

import { acquireSharedMediaStream } from './acquireSharedMediaStream';
import { checkAllRecordingsStopped } from './checkAllRecordingsStopped';
import { cleanupRecordingNode } from './cleanupRecordingNode';
import { clearRecordingStopFlushTimer } from './clearRecordingStopFlushTimer';
import { activeSessions, SAB_BYTES, type RecordingSession } from './recordingSession';
import { terminateRecordingWorker } from './terminateRecordingWorker';

export { audioRecordingStore };
export type { AudioRecordingState } from '../../stores/audioRecordingStore';

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
                    } else {
                        logger.error(new Error(`Recording worker error on track ${trackId}: ${msg.message}`));
                        cleanupRecordingNode(trackId);
                        checkAllRecordingsStopped();
                    }
                };

                recordingWorker.onerror = (event): void => {
                    logger.error(new Error(`Recording worker crashed on track ${trackId}`, { cause: event }));
                    cleanupRecordingNode(trackId);
                    checkAllRecordingsStopped();
                };

                recordingWorker.postMessage({ type: 'init', sab, sampleRate: ctx.sampleRate });

                return true;
            } catch (error) {
                logger.error(new Error(`Failed to start recording on track ${trackId}`, { cause: error }));
                cleanupRecordingNode(trackId);
                return false;
            }
        }
);

// ── Helpers ───────────────────────────────────────────────────────────────────

async function decodeAndDeliver(trackId: string, wavBuffer: ArrayBuffer, ctx: AudioContext): Promise<void> {
    const session = activeSessions.get(trackId);
    if (!session) {
        return;
    }

    // The worker flushed in time — cancel the stop-flush guard.
    clearRecordingStopFlushTimer(session);

    const cb = session.onRecordingComplete;
    session.onRecordingComplete = null;

    if (!cb || wavBuffer.byteLength <= 44) {
        terminateRecordingWorker(session);
        activeSessions.delete(trackId);
        checkAllRecordingsStopped();
        return;
    }

    try {
        const buffer = await ctx.decodeAudioData(wavBuffer);
        cb(buffer);
    } catch (error) {
        logger.error(new Error(`Failed to decode recorded audio for track ${trackId}`, { cause: error }));
    }

    terminateRecordingWorker(session);
    activeSessions.delete(trackId);
    checkAllRecordingsStopped();
}
