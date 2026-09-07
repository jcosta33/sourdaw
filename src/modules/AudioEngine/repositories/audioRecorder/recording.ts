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
import { cleanupNodesForRecordingSession } from './cleanupNodesForRecordingSession';
import { cleanupRecordingNode } from './cleanupRecordingNode';
import { clearRecordingStopFlushTimer } from './clearRecordingStopFlushTimer';
import {
    activeSessions,
    recordingLifecycleState,
    SAB_BYTES,
    type RecordingSession,
    type RecordingTerminalCallback,
} from './recordingSession';
import { releaseSharedMediaStream } from './releaseSharedMediaStream';
import { settleRecordingSession } from './settleRecordingSession';
import { waitForRecordingSessions } from './waitForRecordingSessions';

export { audioRecordingStore };
export type { AudioRecordingState } from '../../stores/audioRecordingStore';

type StartAudioRecording = (
    trackId: string,
    onTerminal: RecordingTerminalCallback,
    inputId?: string | null
) => Promise<boolean>;

export const startAudioRecording: StartAudioRecording = inject({ logger })(
    ({ logger }) =>
        async function startAudioRecording(
            trackId: string,
            onTerminal: RecordingTerminalCallback,
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
                    releaseSharedMediaStream(mediaStream);
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
                    onTerminal,
                    decodePending: false,
                    stopFlushTimer: null,
                    producerStopAcknowledged: false,
                };
                registeredSession = session;
                activeSessions.set(trackId, session);

                readyRecordingNode.port.onmessage = ({ data }: MessageEvent): void => {
                    const msg = data as { type?: string; publishedSampleCount?: number };
                    if (
                        msg.type !== 'stopped' ||
                        activeSessions.get(trackId) !== session ||
                        session.status !== 'stopping' ||
                        session.producerStopAcknowledged
                    ) {
                        return;
                    }
                    session.producerStopAcknowledged = true;
                    readyRecordingWorker.postMessage({
                        type: 'stop',
                        expectedFinalSampleCount: msg.publishedSampleCount,
                    });
                    cleanupNodesForRecordingSession(session);
                };

                // Wire up the PCM-complete handler before sending 'start'.
                recordingWorker.onmessage = ({ data }: MessageEvent): void => {
                    const msg = data as
                        | { type: 'ready' }
                        | { type: 'wav'; buffer: ArrayBuffer }
                        | { type: 'error'; message: string; tempFile?: string };

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
                        settleRecordingSession(session, { kind: 'failed', reason: 'worker-error' });
                        // The worker names the abandoned take's temp file because
                        // it cannot remove the file itself: settlement terminated
                        // it, and a terminated worker never resumes its
                        // in-flight removeEntry — this thread outlives it. A
                        // missing entry is fine: the file may never have been
                        // created or may already be gone.
                        if (msg.tempFile !== undefined) {
                            const tempFile = msg.tempFile;
                            void navigator.storage
                                .getDirectory()
                                .then((root) => root.removeEntry(tempFile))
                                .catch((error: unknown) =>
                                    logger.debug(`Abandoned recording temp file ${tempFile} not removed`, error)
                                );
                        }
                    }
                };

                recordingWorker.onerror = (event): void => {
                    logger.error(new Error(`Recording worker crashed on track ${trackId}`, { cause: event }));
                    settleRecordingSession(session, { kind: 'failed', reason: 'worker-crash' });
                };

                recordingWorker.postMessage({ type: 'init', sab, sampleRate: ctx.sampleRate });

                return true;
            } catch (error) {
                logger.error(new Error(`Failed to start recording on track ${trackId}`, { cause: error }));
                const sessionWasRegistered =
                    registeredSession !== null && activeSessions.get(trackId) === registeredSession;
                if (registeredSession) {
                    registeredSession.onTerminal = null;
                    cleanupRecordingNode({ expectedSession: registeredSession, trackId });
                }
                if (!sessionWasRegistered && mediaStream) {
                    recordingWorker?.terminate();
                    recordingNode?.disconnect();
                    sourceNode?.disconnect();
                    releaseSharedMediaStream(mediaStream);
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
    if (session.decodePending) {
        return;
    }
    session.decodePending = true;

    // The worker flushed in time — cancel the stop-flush guard.
    clearRecordingStopFlushTimer(session);

    if (wavBuffer.byteLength <= 44) {
        settleRecordingSession(session, { kind: 'failed', reason: 'empty-wav' });
        return;
    }

    try {
        const buffer = await ctx.decodeAudioData(wavBuffer);
        if (activeSessions.get(trackId) !== session) {
            return;
        }
        settleRecordingSession(session, { kind: 'completed', buffer });
    } catch (error) {
        if (activeSessions.get(trackId) !== session) {
            return;
        }
        logger.error(new Error(`Failed to decode recorded audio for track ${trackId}`, { cause: error }));
        settleRecordingSession(session, { kind: 'failed', reason: 'decode-failed' });
    }
}
