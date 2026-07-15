import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { audioRecordingStore } from '../../../stores/audioRecordingStore';
import { audioEngine } from '../../createWebAudioEngine';
import { startAudioRecording } from '../recording';
import { stopAudioRecording } from '../stopAudioRecording';

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
    port = { postMessage: vi.fn() };
    connect = vi.fn();
    disconnect = vi.fn();
    constructor() {
        FakeAudioWorkletNode.last = this;
    }
}

describe('stopAudioRecording', () => {
    let media_track_stop: ReturnType<typeof vi.fn>;
    let source_disconnect: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        vi.useFakeTimers();
        FakeWorker.last = null;
        FakeAudioWorkletNode.last = null;
        media_track_stop = vi.fn();
        source_disconnect = vi.fn();
        audioRecordingStore.set({ isRecording: false, micPermissionGranted: false });
        Object.defineProperty(globalThis.navigator, 'mediaDevices', {
            value: {
                getUserMedia: vi.fn().mockResolvedValue({
                    getTracks: () => [{ stop: media_track_stop }],
                }),
            },
            configurable: true,
        });
        vi.mocked(audioEngine.context.createMediaStreamSource).mockReturnValue({
            connect: vi.fn(),
            disconnect: source_disconnect,
        } as MediaStreamAudioSourceNode);
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

    async function startAndArm(trackId: string): Promise<{
        worker: FakeWorker;
        worklet: FakeAudioWorkletNode;
    }> {
        await expect(startAudioRecording(trackId, vi.fn())).resolves.toBe(true);
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

    it('should stop ports, disconnect nodes, release the stream, and clear recording state', async () => {
        const { worker, worklet } = await startAndArm('track-stop');
        expect(audioRecordingStore.value?.isRecording).toBe(true);

        stopAudioRecording();

        expect(worklet.port.postMessage).toHaveBeenCalledWith({ type: 'stop' });
        expect(worker.postMessage).toHaveBeenCalledWith({ type: 'stop' });
        expect(worklet.disconnect).toHaveBeenCalledTimes(1);
        expect(source_disconnect).toHaveBeenCalledTimes(1);
        expect(media_track_stop).toHaveBeenCalledTimes(1);
        expect(audioRecordingStore.value?.isRecording).toBe(false);
    });

    it('resolves stop only after the recording worker finishes delivery', async () => {
        const { worker } = await startAndArm('track-flush');
        let settled = false;

        const stopping = Promise.resolve(stopAudioRecording()).then(() => {
            settled = true;
        });
        await Promise.resolve();

        expect(settled).toBe(false);
        worker.emit({ type: 'wav', buffer: new ArrayBuffer(40) });
        await stopping;
        expect(settled).toBe(true);
    });

    it('should terminate a worker that never flushes and free the track to re-record', async () => {
        const { worker } = await startAndArm('track-stall');

        stopAudioRecording();
        expect(worker.terminate).not.toHaveBeenCalled();
        vi.advanceTimersByTime(5_000);

        expect(worker.terminate).toHaveBeenCalledTimes(1);

        const restart = await startAndArm('track-stall');
        expect(restart.worker).toBeInstanceOf(FakeWorker);
    });

    it('should not force-terminate when the worker flushes within the deadline', async () => {
        const { worker } = await startAndArm('track-ok');

        stopAudioRecording();
        worker.emit({ type: 'wav', buffer: new ArrayBuffer(40) });
        await Promise.resolve();

        const calls_after_flush = worker.terminate.mock.calls.length;
        vi.advanceTimersByTime(5_000);
        expect(worker.terminate.mock.calls.length).toBe(calls_after_flush);
    });
});
