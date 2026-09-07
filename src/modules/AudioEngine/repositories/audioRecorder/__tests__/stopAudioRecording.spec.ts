import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';

import { logger } from '#/infra/logger/appLogger';

import { audioRecordingStore } from '../../../stores/audioRecordingStore';
import { audioEngine } from '../../createWebAudioEngine';
import { cleanupNodesForRecordingSession } from '../cleanupNodesForRecordingSession';
import { startAudioRecording } from '../recording';
import { activeSessions, sharedStreamState } from '../recordingSession';
import { stopAudioRecording } from '../stopAudioRecording';
import { terminateRecordingWorker } from '../terminateRecordingWorker';

vi.mock('#/infra/logger/appLogger', () => ({
    logger: {
        warn: vi.fn(),
        error: vi.fn(),
        info: vi.fn(),
    },
}));

vi.mock('#/modules/AudioEngine/repositories/createWebAudioEngine', () => ({
    audioEngine: {
        context: {
            sampleRate: 48000,
            createMediaStreamSource: vi.fn(),
            createBuffer: vi.fn(),
            decodeAudioData: vi.fn(),
        },
        ensureTrackStrip: vi.fn(() => ({
            gainNode: { connect: vi.fn() },
        })),
    },
}));

class FakeWorker {
    static last: FakeWorker | null = null;
    onmessage: ((event: { data: unknown }) => void) | null = null;
    onerror: ((event: unknown) => void) | null = null;
    postMessage = vi.fn();
    terminate = vi.fn();
    constructor() {
        FakeWorker.last = this;
    }
    emit(data: unknown): void {
        this.onmessage?.({ data });
    }
}

class FakeAudioWorkletNode {
    static last: FakeAudioWorkletNode | null = null;
    port: {
        postMessage: ReturnType<typeof vi.fn>;
        onmessage: ((event: { data: unknown }) => void) | null;
    } = { postMessage: vi.fn(), onmessage: null };
    connect = vi.fn();
    disconnect = vi.fn();
    constructor() {
        FakeAudioWorkletNode.last = this;
    }
    emit(data: unknown): void {
        this.port.onmessage?.({ data });
    }
}

function make_media_stream_source(disconnect: () => void = vi.fn()): MediaStreamAudioSourceNode {
    return {
        context: {} as BaseAudioContext,
        numberOfInputs: 0,
        numberOfOutputs: 1,
        channelCount: 2,
        channelCountMode: 'max',
        channelInterpretation: 'speakers',
        connect: vi.fn(),
        disconnect,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(() => true),
        mediaStream: {} as MediaStream,
    };
}

function make_audio_buffer(): AudioBuffer {
    const samples = new Float32Array([0.25, -0.5]);
    return {
        duration: samples.length / 48_000,
        length: samples.length,
        numberOfChannels: 1,
        sampleRate: 48_000,
        getChannelData: () => samples,
        copyFromChannel: (destination) => destination.set(samples),
        copyToChannel: (source) => samples.set(source),
    };
}

describe('stopAudioRecording', () => {
    let media_track_stop: ReturnType<typeof vi.fn>;
    let source_disconnect: Mock<() => void>;

    beforeEach(() => {
        vi.useFakeTimers();
        vi.clearAllMocks();
        FakeWorker.last = null;
        FakeAudioWorkletNode.last = null;
        media_track_stop = vi.fn();
        source_disconnect = vi.fn<() => void>();
        audioRecordingStore.set({ isRecording: false, micPermissionGranted: false });
        Object.defineProperty(globalThis.navigator, 'mediaDevices', {
            value: {
                getUserMedia: vi.fn().mockResolvedValue({
                    getTracks: () => [{ stop: media_track_stop }],
                }),
            },
            configurable: true,
        });
        vi.mocked(audioEngine.context.createMediaStreamSource).mockReturnValue(
            make_media_stream_source(source_disconnect)
        );
        vi.mocked(audioEngine.context.decodeAudioData).mockReset();
        vi.mocked(audioEngine.context.decodeAudioData).mockResolvedValue(make_audio_buffer());
        vi.stubGlobal('SharedArrayBuffer', ArrayBuffer);
        vi.stubGlobal('Worker', FakeWorker);
        vi.stubGlobal('AudioWorkletNode', FakeAudioWorkletNode);
        vi.stubGlobal('URL', class {});
    });

    afterEach(() => {
        stopAudioRecording();
        vi.advanceTimersByTime(5_000);
        vi.useRealTimers();
        vi.unstubAllGlobals();
    });

    async function startAndArm(
        trackId: string,
        onTerminal: Parameters<typeof startAudioRecording>[1] = vi.fn()
    ): Promise<{
        worker: FakeWorker;
        worklet: FakeAudioWorkletNode;
    }> {
        await expect(startAudioRecording(trackId, onTerminal)).resolves.toBe(true);
        await Promise.resolve();
        await Promise.resolve();
        const worker = FakeWorker.last;
        const worklet = FakeAudioWorkletNode.last;
        if (!worker || !worklet) {
            throw new Error('recording test doubles were not created');
        }
        worker.emit({ type: 'ready' });
        return { worker, worklet };
    }

    it('returns false without a terminal callback when setup fails after session registration', async () => {
        class InitFailWorker extends FakeWorker {
            override postMessage = vi.fn(() => {
                throw new Error('worker init failed');
            });
        }
        vi.stubGlobal('Worker', InitFailWorker);
        const onTerminal = vi.fn();

        await expect(startAudioRecording('track-init-fail', onTerminal)).resolves.toBe(false);

        expect(onTerminal).not.toHaveBeenCalled();
        expect(activeSessions.get('track-init-fail')).toBeUndefined();
        expect(audioRecordingStore.value?.isRecording).toBe(false);
        expect(FakeWorker.last?.terminate).toHaveBeenCalledOnce();
        expect(source_disconnect).toHaveBeenCalledOnce();
        expect(media_track_stop).toHaveBeenCalledOnce();
    });

    it('waits for the captured producer stop acknowledgment before draining and releasing nodes', async () => {
        const { worker, worklet } = await startAndArm('track-stop');
        expect(audioRecordingStore.value?.isRecording).toBe(true);

        stopAudioRecording();

        expect(worklet.port.postMessage).toHaveBeenCalledWith({ type: 'stop' });
        expect(worker.postMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'stop' }));
        expect(worklet.disconnect).not.toHaveBeenCalled();
        expect(source_disconnect).not.toHaveBeenCalled();
        expect(media_track_stop).not.toHaveBeenCalled();

        worklet.emit({ type: 'stopped', publishedSampleCount: 256 });

        expect(worker.postMessage).toHaveBeenCalledWith({ type: 'stop', expectedFinalSampleCount: 256 });
        expect(worklet.disconnect).toHaveBeenCalledTimes(1);
        expect(source_disconnect).toHaveBeenCalledTimes(1);
        expect(media_track_stop).toHaveBeenCalledTimes(1);
        expect(audioRecordingStore.value?.isRecording).toBe(false);
    });

    it('resolves stop only after the recording worker finishes delivery', async () => {
        let resolveDecode: ((buffer: AudioBuffer) => void) | undefined;
        const decodePending = new Promise<AudioBuffer>((resolve) => {
            resolveDecode = resolve;
        });
        vi.mocked(audioEngine.context.decodeAudioData).mockReturnValue(decodePending);
        const decodedBuffer = make_audio_buffer();
        const deliveryOrder: string[] = [];
        const onTerminal = vi.fn((result: { kind: string; buffer?: AudioBuffer }) => {
            expect(result).toEqual({ kind: 'completed', buffer: decodedBuffer });
            deliveryOrder.push('callback');
        });
        const { worker, worklet } = await startAndArm('track-flush', onTerminal);
        const session = activeSessions.get('track-flush');
        if (!session) {
            throw new Error('Expected a recording session');
        }
        let settled = false;

        const stopping = Promise.resolve(stopAudioRecording()).then(() => {
            settled = true;
            deliveryOrder.push('settled');
        });
        await Promise.resolve();

        expect(settled).toBe(false);
        worklet.emit({ type: 'stopped', publishedSampleCount: 2 });

        // ACK releases input resources but retains its worker/session until
        // the worker's nonempty WAV has decoded and reached the caller.
        await Promise.resolve();
        expect(settled).toBe(false);
        expect(activeSessions.get('track-flush')).toBe(session);
        expect(worker.terminate).not.toHaveBeenCalled();
        expect(worklet.disconnect).toHaveBeenCalledOnce();
        expect(source_disconnect).toHaveBeenCalledOnce();
        expect(media_track_stop).toHaveBeenCalledOnce();

        const wav = new ArrayBuffer(52);
        worker.emit({ type: 'wav', buffer: wav });
        await Promise.resolve();

        expect(audioEngine.context.decodeAudioData).toHaveBeenCalledWith(wav);
        expect(onTerminal).not.toHaveBeenCalled();
        expect(settled).toBe(false);
        expect(activeSessions.get('track-flush')).toBe(session);
        expect(worker.terminate).not.toHaveBeenCalled();

        const resolve = resolveDecode;
        if (!resolve) {
            throw new Error('Expected decodeAudioData to be pending');
        }
        resolve(decodedBuffer);
        await stopping;

        expect(onTerminal).toHaveBeenCalledOnce();
        expect(onTerminal).toHaveBeenCalledWith({ kind: 'completed', buffer: decodedBuffer });
        expect(deliveryOrder).toEqual(['callback', 'settled']);
        expect(settled).toBe(true);
        expect(activeSessions.get('track-flush')).toBeUndefined();
        expect(worker.terminate).toHaveBeenCalledOnce();
    });

    it('ignores a late ready event after stop has become terminal', async () => {
        const onTerminal = vi.fn();
        await expect(startAudioRecording('track-late-ready', onTerminal)).resolves.toBe(true);
        const worker = FakeWorker.last;
        const worklet = FakeAudioWorkletNode.last;
        if (!worker || !worklet) {
            throw new Error('Expected recording test doubles');
        }

        const stopping = stopAudioRecording();
        worker.emit({ type: 'ready' });

        expect(worklet.port.postMessage).not.toHaveBeenCalledWith({ type: 'start' });
        expect(worker.postMessage).not.toHaveBeenCalledWith({ type: 'start' });
        expect(audioRecordingStore.value?.isRecording).toBe(false);

        worklet.emit({ type: 'stopped', publishedSampleCount: 0 });
        expect(worker.postMessage).toHaveBeenCalledWith({ type: 'stop', expectedFinalSampleCount: 0 });
        worker.emit({ type: 'wav', buffer: new ArrayBuffer(44) });
        await stopping;

        expect(onTerminal).toHaveBeenCalledOnce();
        expect(onTerminal).toHaveBeenCalledWith({ kind: 'failed', reason: 'empty-wav' });
    });

    it('terminates the worker when its recording session fails', async () => {
        const onTerminal = vi.fn();
        await expect(startAudioRecording('track-worker-error', onTerminal)).resolves.toBe(true);
        const worker = FakeWorker.last;
        if (!worker) {
            throw new Error('Expected recording worker');
        }

        worker.onerror?.({});

        expect(worker.terminate).toHaveBeenCalledOnce();
        expect(onTerminal).toHaveBeenCalledOnce();
        expect(onTerminal).toHaveBeenCalledWith({ kind: 'failed', reason: 'worker-crash' });
    });

    it('removes the named temporary file when the worker abandons an integrity-failed take', async () => {
        const removeEntry = vi.fn().mockResolvedValue(undefined);
        Object.defineProperty(globalThis.navigator, 'storage', {
            configurable: true,
            value: { getDirectory: vi.fn().mockResolvedValue({ removeEntry }) },
        });
        const onTerminal = vi.fn();
        const { worker } = await startAndArm('track-worker-integrity-error', onTerminal);

        worker.emit({ type: 'error', message: 'Recording ring overrun', tempFile: 'rec-tmp-123.pcm' });
        await Promise.resolve();
        await Promise.resolve();

        expect(worker.terminate).toHaveBeenCalledOnce();
        expect(onTerminal).toHaveBeenCalledOnce();
        expect(onTerminal).toHaveBeenCalledWith({ kind: 'failed', reason: 'worker-error' });
        expect(removeEntry).toHaveBeenCalledWith('rec-tmp-123.pcm');
    });

    it('tears down the captured session when the producer never acknowledges stop', async () => {
        const onTerminal = vi.fn();
        const { worker, worklet } = await startAndArm('track-stall', onTerminal);

        stopAudioRecording();
        expect(worker.terminate).not.toHaveBeenCalled();
        vi.advanceTimersByTime(5_000);

        expect(worker.terminate).toHaveBeenCalledTimes(1);
        expect(worklet.disconnect).toHaveBeenCalledOnce();
        expect(source_disconnect).toHaveBeenCalledOnce();
        expect(media_track_stop).toHaveBeenCalledOnce();
        expect(onTerminal).toHaveBeenCalledOnce();
        expect(onTerminal).toHaveBeenCalledWith({ kind: 'failed', reason: 'flush-timeout' });

        const restart = await startAndArm('track-stall');
        expect(restart.worker).toBeInstanceOf(FakeWorker);
    });

    it('keeps the original flush deadline after ACK and sends the final worker stop only once', async () => {
        const { worker, worklet } = await startAndArm('track-ok');

        stopAudioRecording();
        vi.advanceTimersByTime(4_000);
        worklet.emit({ type: 'stopped', publishedSampleCount: 128 });
        worklet.emit({ type: 'stopped', publishedSampleCount: 256 });

        expect(worker.postMessage).toHaveBeenCalledTimes(3);
        expect(worker.postMessage).toHaveBeenLastCalledWith({ type: 'stop', expectedFinalSampleCount: 128 });
        vi.advanceTimersByTime(999);
        expect(worker.terminate).not.toHaveBeenCalled();
        vi.advanceTimersByTime(1);
        expect(worker.terminate).toHaveBeenCalledOnce();
    });

    it('does not force-terminate when the worker flushes within the acknowledgment deadline', async () => {
        const { worker, worklet } = await startAndArm('track-flush-ok');

        stopAudioRecording();
        worklet.emit({ type: 'stopped', publishedSampleCount: 0 });
        worker.emit({ type: 'wav', buffer: new ArrayBuffer(44) });
        await Promise.resolve();

        const calls_after_flush = worker.terminate.mock.calls.length;
        vi.advanceTimersByTime(5_000);
        expect(worker.terminate.mock.calls.length).toBe(calls_after_flush);
    });

    it('settles a decode rejection once and releases the stopped session', async () => {
        const decodeError = new Error('bad wav');
        vi.mocked(audioEngine.context.decodeAudioData).mockRejectedValueOnce(decodeError);
        const onTerminal = vi.fn();
        const { worker, worklet } = await startAndArm('track-decode-failed', onTerminal);

        const stopping = stopAudioRecording();
        worklet.emit({ type: 'stopped', publishedSampleCount: 2 });
        worker.emit({ type: 'wav', buffer: new ArrayBuffer(52) });
        await stopping;

        expect(onTerminal).toHaveBeenCalledOnce();
        expect(onTerminal).toHaveBeenCalledWith({ kind: 'failed', reason: 'decode-failed' });
        expect(worker.terminate).toHaveBeenCalledOnce();
        expect(activeSessions.get('track-decode-failed')).toBeUndefined();
        expect(audioRecordingStore.value?.isRecording).toBe(false);
        expect(logger.error).toHaveBeenCalledWith(expect.objectContaining({ cause: decodeError }));
    });

    it('rejects a duplicate WAV while decode is pending without retiring the session', async () => {
        let resolveDecode: ((buffer: AudioBuffer) => void) | undefined;
        vi.mocked(audioEngine.context.decodeAudioData).mockReturnValueOnce(
            new Promise<AudioBuffer>((resolve) => {
                resolveDecode = resolve;
            })
        );
        const decodedBuffer = make_audio_buffer();
        const onTerminal = vi.fn();
        const { worker, worklet } = await startAndArm('track-duplicate-wav', onTerminal);
        const session = activeSessions.get('track-duplicate-wav');

        const stopping = stopAudioRecording();
        worklet.emit({ type: 'stopped', publishedSampleCount: 2 });
        worker.emit({ type: 'wav', buffer: new ArrayBuffer(52) });
        worker.emit({ type: 'wav', buffer: new ArrayBuffer(60) });
        await Promise.resolve();

        expect(audioEngine.context.decodeAudioData).toHaveBeenCalledOnce();
        expect(activeSessions.get('track-duplicate-wav')).toBe(session);
        expect(onTerminal).not.toHaveBeenCalled();
        expect(worker.terminate).not.toHaveBeenCalled();

        const resolve = resolveDecode;
        if (!resolve) {
            throw new Error('Expected decode to be pending');
        }
        resolve(decodedBuffer);
        await stopping;

        expect(onTerminal).toHaveBeenCalledOnce();
        expect(onTerminal).toHaveBeenCalledWith({ kind: 'completed', buffer: decodedBuffer });
        expect(worker.terminate).toHaveBeenCalledOnce();
    });

    it('cleans up and resolves stop when the terminal callback throws', async () => {
        const callbackError = new Error('consumer failed');
        const onTerminal = vi.fn(() => {
            throw callbackError;
        });
        const { worker, worklet } = await startAndArm('track-callback-error', onTerminal);

        const stopping = stopAudioRecording();
        worklet.emit({ type: 'stopped', publishedSampleCount: 2 });
        worker.emit({ type: 'wav', buffer: new ArrayBuffer(52) });
        await stopping;

        expect(onTerminal).toHaveBeenCalledOnce();
        expect(worker.terminate).toHaveBeenCalledOnce();
        expect(activeSessions.get('track-callback-error')).toBeUndefined();
        expect(audioRecordingStore.value?.isRecording).toBe(false);
        expect(logger.error).toHaveBeenCalledWith(expect.objectContaining({ cause: callbackError }));
    });

    it('ignores a queued stale acknowledgment after the same track has a replacement session', async () => {
        const original = await startAndArm('track-stale-ack');
        const originalSession = activeSessions.get('track-stale-ack');
        if (!originalSession) {
            throw new Error('Expected original recording session');
        }
        stopAudioRecording();
        const queuedOriginalAck = original.worklet.port.onmessage;
        const originalMessageCount = original.worker.postMessage.mock.calls.length;
        vi.advanceTimersByTime(5_000);

        const replacement = await startAndArm('track-stale-ack');
        queuedOriginalAck?.({ data: { type: 'stopped', publishedSampleCount: 42 } });

        expect(original.worker.postMessage).toHaveBeenCalledTimes(originalMessageCount);
        expect(originalSession.producerStopAcknowledged).toBe(false);
        expect(replacement.worker.postMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'stop' }));
        expect(replacement.worker.terminate).not.toHaveBeenCalled();
        expect(replacement.worklet.disconnect).not.toHaveBeenCalled();
        expect(activeSessions.get('track-stale-ack')).not.toBe(originalSession);
        expect(audioRecordingStore.value?.isRecording).toBe(true);
    });

    it('keeps a same-track successor when an obsolete decode settles after the original session fails', async () => {
        let resolveDecode: ((buffer: AudioBuffer) => void) | undefined;
        vi.mocked(audioEngine.context.decodeAudioData).mockReturnValueOnce(
            new Promise<AudioBuffer>((resolve) => {
                resolveDecode = resolve;
            })
        );
        const originalOrder: string[] = [];
        const originalTerminal = vi.fn(() => {
            originalOrder.push('failed');
        });
        const original = await startAndArm('track-stale-decode', originalTerminal);
        const originalSession = activeSessions.get('track-stale-decode');
        if (!originalSession) {
            throw new Error('Expected original recording session');
        }

        const originalStopping = stopAudioRecording().then(() => {
            originalOrder.push('settled');
        });
        original.worklet.emit({ type: 'stopped', publishedSampleCount: 2 });
        original.worker.emit({ type: 'wav', buffer: new ArrayBuffer(52) });
        await Promise.resolve();
        original.worker.onerror?.({});
        await originalStopping;

        const successor = await startAndArm('track-stale-decode');
        const successorSession = activeSessions.get('track-stale-decode');
        if (!successorSession) {
            throw new Error('Expected successor recording session');
        }
        const resolve = resolveDecode;
        if (!resolve) {
            throw new Error('Expected original decode to be pending');
        }
        resolve(make_audio_buffer());
        await Promise.resolve();
        await Promise.resolve();

        expect(originalTerminal).toHaveBeenCalledOnce();
        expect(originalTerminal).toHaveBeenCalledWith({ kind: 'failed', reason: 'worker-crash' });
        expect(originalOrder).toEqual(['failed', 'settled']);
        expect(activeSessions.get('track-stale-decode')).toBe(successorSession);
        expect(audioRecordingStore.value?.isRecording).toBe(true);
        expect(original.worker.terminate).toHaveBeenCalledOnce();
        expect(original.worklet.disconnect).toHaveBeenCalledOnce();
        expect(source_disconnect).toHaveBeenCalledOnce();
        expect(media_track_stop).toHaveBeenCalledOnce();
        expect(successor.worker.terminate).not.toHaveBeenCalled();
        expect(successor.worklet.disconnect).not.toHaveBeenCalled();
    });

    it('does not let a stale captured timeout tear down a same-track successor', async () => {
        await startAndArm('track-stale-timer');
        stopAudioRecording();
        const originalSession = activeSessions.get('track-stale-timer');
        if (!originalSession) {
            throw new Error('Expected original recording session');
        }

        // A normal cleanup clears this timer. This deliberately preserves a
        // stale timer while replacing the map entry to prove its identity
        // guard cannot clean the successor's worker, nodes, or recording flag.
        activeSessions.delete('track-stale-timer');
        const successor = await startAndArm('track-stale-timer');
        vi.advanceTimersByTime(5_000);

        expect(successor.worker.terminate).not.toHaveBeenCalled();
        expect(successor.worklet.disconnect).not.toHaveBeenCalled();
        expect(activeSessions.get('track-stale-timer')).not.toBe(originalSession);
        expect(audioRecordingStore.value?.isRecording).toBe(true);

        terminateRecordingWorker(originalSession);
        cleanupNodesForRecordingSession(originalSession);
    });

    it('stops each of two distinct streams exactly once when both sessions end', async () => {
        const firstTrackStop = vi.fn();
        const secondTrackStop = vi.fn();
        const firstStream = { getTracks: () => [{ stop: firstTrackStop }] } as unknown as MediaStream;
        const secondStream = { getTracks: () => [{ stop: secondTrackStop }] } as unknown as MediaStream;
        vi.mocked(globalThis.navigator.mediaDevices.getUserMedia)
            .mockResolvedValueOnce(firstStream)
            .mockResolvedValueOnce(secondStream);

        await expect(startAudioRecording('track-distinct-a', vi.fn())).resolves.toBe(true);
        const firstWorklet = FakeAudioWorkletNode.last;
        if (!firstWorklet) {
            throw new Error('Expected first recording worklet');
        }
        // Decouple the cached pointer from the still-owned first stream — the
        // ownership shape concurrent pre-fix acquisition left behind, where a
        // global count stopped only whichever stream the pointer held last.
        sharedStreamState.stream = null;
        await expect(startAudioRecording('track-distinct-b', vi.fn())).resolves.toBe(true);
        const secondWorklet = FakeAudioWorkletNode.last;
        if (!secondWorklet) {
            throw new Error('Expected second recording worklet');
        }

        expect(globalThis.navigator.mediaDevices.getUserMedia).toHaveBeenCalledTimes(2);

        stopAudioRecording();
        firstWorklet.emit({ type: 'stopped', publishedSampleCount: 0 });
        secondWorklet.emit({ type: 'stopped', publishedSampleCount: 0 });

        expect(firstTrackStop).toHaveBeenCalledTimes(1);
        expect(secondTrackStop).toHaveBeenCalledTimes(1);
    });
});
