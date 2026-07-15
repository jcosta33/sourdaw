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
import { activeSessions, recordingLifecycleState, SAB_BYTES, type RecordingSession } from './recordingSession';
import { releaseSharedMediaStream } from './releaseSharedMediaStream';
import { terminateRecordingWorker } from './terminateRecordingWorker';
import { waitForRecordingSessions } from './waitForRecordingSessions';

export { audioRecordingStore };
export type { AudioRecordingState } from '../../stores/audioRecordingStore';

export const startAudioRecording = inject({ logger })(
    ({ logger }) =>
        async function startAudioRecording(
            trackId: string,
            onComplete: (buffer: AudioBuffer) => void,
            inputId: string | null = null
        ): Promise<boolean> {
            const startGeneration = recordingLifecycleState.startGeneration;
            let mediaStream: MediaStream | null = null;
            let sourceNode: MediaStreamAudioSourceNode | null = null;
            let recordingNode: AudioWorkletNode | null = null;
            let recordingWorker: Worker | null = null;
            let registeredSession: RecordingSession | null = null;
            try {
                const currentSession = activeSessions.get(trackId);
                if (currentSession?.status === 'stopping') {
                    await waitForRecordingSessions(new Set([trackId]));
                    if (startGeneration !== recordingLifecycleState.startGeneration) {
                        return false;
                    }
                }
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

                mediaStream = await acquireSharedMediaStream(audioConstraints);
                if (startGeneration !== recordingLifecycleState.startGeneration || activeSessions.has(trackId)) {
                    releaseSharedMediaStream();
                    mediaStream = null;
                    return false;
                }
                const ctx = audioEngine.context;
                sourceNode = ctx.createMediaStreamSource(mediaStream);

                // Monitor via the track strip (same as before).
                const strip = audioEngine.ensureTrackStrip(trackId);
                sourceNode.connect(strip.gainNode);

                // ── SAB ring ─────────────────────────────────────────────────────────
                const sab = new SharedArrayBuffer(SAB_BYTES);

                // ── AudioWorkletNode (recording-processor) ───────────────────────────
                recordingNode = new AudioWorkletNode(ctx, 'recording-processor', {
                    numberOfInputs: 1,
                    numberOfOutputs: 0,
                    channelCount: 1,
                    channelCountMode: 'explicit',
                    channelInterpretation: 'discrete',
                });
                recordingNode.port.postMessage({ type: 'init', sab });
                sourceNode.connect(recordingNode);

                // ── OPFS Worker ──────────────────────────────────────────────────────
                recordingWorker = new Worker(new URL('../../workers/recordingWorker.ts', import.meta.url), {
                    type: 'module',
                });
                const readyRecordingNode = recordingNode;
                const readyRecordingWorker = recordingWorker;

                const session: RecordingSession = {
                    trackId,
                    mediaStream,
                    sourceNode,
                    recordingNode: readyRecordingNode,
                    recordingWorker: readyRecordingWorker,
                    status: 'starting',
                    onRecordingComplete: onComplete,
                    stopFlushTimer: null,
                };
                registeredSession = session;
                activeSessions.set(trackId, session);

                // Wire up the PCM-complete handler before sending 'start'.
                recordingWorker.onmessage = ({ data }: MessageEvent): void => {
                    const msg = data as
                        | { type: 'ready' }
                        | { type: 'wav'; buffer: ArrayBuffer }
                        | { type: 'error'; message: string };

                    if (msg.type === 'ready') {
                        if (activeSessions.get(trackId) !== session || session.status !== 'starting') {
                            return;
                        }
                        // Both sides are initialised — begin capture.
                        session.status = 'recording';
                        readyRecordingNode.port.postMessage({ type: 'start' });
                        readyRecordingWorker.postMessage({ type: 'start' });
                        audioRecordingStore.set({ ...audioRecordingStore.value!, isRecording: true });
                    } else if (msg.type === 'wav') {
                        // Worker has flushed OPFS → decode WAV on the main thread.
                        void decodeAndDeliver(session, msg.buffer, ctx);
                    } else {
                        logger.error(new Error(`Recording worker error on track ${trackId}: ${msg.message}`));
                        cleanupRecordingNode({ expectedSession: session, trackId });
                    }
                };

                recordingWorker.onerror = (event): void => {
                    logger.error(new Error(`Recording worker crashed on track ${trackId}`, { cause: event }));
                    cleanupRecordingNode({ expectedSession: session, trackId });
                };

                recordingWorker.postMessage({ type: 'init', sab, sampleRate: ctx.sampleRate });

                return true;
            } catch (error) {
                logger.error(new Error(`Failed to start recording on track ${trackId}`, { cause: error }));
                const sessionWasRegistered =
                    registeredSession !== null && activeSessions.get(trackId) === registeredSession;
                if (registeredSession) {
                    cleanupRecordingNode({ expectedSession: registeredSession, trackId });
                }
                if (!sessionWasRegistered && mediaStream) {
                    recordingWorker?.terminate();
                    recordingNode?.disconnect();
                    sourceNode?.disconnect();
                    releaseSharedMediaStream();
                }
                return false;
            }
        }
);

// ── Helpers ───────────────────────────────────────────────────────────────────

async function decodeAndDeliver(session: RecordingSession, wavBuffer: ArrayBuffer, ctx: AudioContext): Promise<void> {
    const { trackId } = session;
    if (activeSessions.get(trackId) !== session) {
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
