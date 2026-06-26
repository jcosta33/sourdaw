import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { logger } from '#/infra/logger/appLogger';

import { getSelectedInputId } from '../../../useCases/audioDeviceSelection/getSelectedInputId';
import { audioEngine } from '../../createWebAudioEngine';
import { startAudioRecording, stopAudioRecording } from '../recording';

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
            createMediaStreamSource: vi.fn(() => ({
                connect: vi.fn(),
            })),
            createBuffer: vi.fn(),
        },
        ensureTrackStrip: vi.fn(() => ({
            gainNode: { connect: vi.fn() },
        })),
    },
}));

vi.mock('../../../useCases/audioDeviceSelection/getSelectedInputId', () => ({
    getSelectedInputId: vi.fn(() => null),
}));

describe('startAudioRecording', () => {
    beforeEach(() => {
        vi.mocked(getSelectedInputId).mockReturnValue(null);
        Object.defineProperty(globalThis.navigator, 'mediaDevices', {
            value: {
                getUserMedia: vi.fn().mockRejectedValue(new Error('mic denied')),
            },
            configurable: true,
        });
    });

    it('should return false and log when microphone access fails', async () => {
        const onComplete = vi.fn();
        const ok = await startAudioRecording('track-1', onComplete);

        expect(ok).toBe(false);
        expect(logger.error).toHaveBeenCalled();
        expect(onComplete).not.toHaveBeenCalled();
        expect(audioEngine.ensureTrackStrip).not.toHaveBeenCalled();
    });
});

// A captured stand-in for the OPFS worker so the test can drive its lifecycle
// and observe terminate(). Each `new Worker(...)` records the latest instance.
class FakeWorker {
    static last: FakeWorker | null = null;
    onmessage: ((event: { data: unknown }) => void) | null = null;
    onerror: ((event: unknown) => void) | null = null;
    postMessage = vi.fn();
    terminate = vi.fn();
    constructor() {
        FakeWorker.last = this;
    }
    /** Simulate the worker posting a message back to the main thread. */
    emit(data: unknown): void {
        this.onmessage?.({ data });
    }
}

class FakeAudioWorkletNode {
    port = { postMessage: vi.fn() };
    connect = vi.fn();
    disconnect = vi.fn();
}

describe('stopAudioRecording — stalled-worker teardown (Observation 4)', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        FakeWorker.last = null;
        vi.mocked(getSelectedInputId).mockReturnValue(null);
        Object.defineProperty(globalThis.navigator, 'mediaDevices', {
            value: {
                getUserMedia: vi.fn().mockResolvedValue({
                    getTracks: () => [{ stop: vi.fn() }],
                }),
            },
            configurable: true,
        });
        vi.mocked(audioEngine.context.createMediaStreamSource).mockReturnValue({
            connect: vi.fn(),
            disconnect: vi.fn(),
        } as unknown as MediaStreamAudioSourceNode);
        vi.stubGlobal('SharedArrayBuffer', ArrayBuffer);
        vi.stubGlobal('Worker', FakeWorker);
        vi.stubGlobal('AudioWorkletNode', FakeAudioWorkletNode);
        vi.stubGlobal('URL', class {});
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.unstubAllGlobals();
    });

    async function startAndArm(trackId: string): Promise<FakeWorker> {
        const started = startAudioRecording(trackId, vi.fn());
        await Promise.resolve();
        await Promise.resolve();
        const worker = FakeWorker.last;
        if (!worker) {
            throw new Error('worker was not created');
        }
        // Worker signals ready → capture begins and the session is registered.
        worker.emit({ type: 'ready' });
        await started;
        return worker;
    }

    it('terminates a worker that never flushes after stop, freeing the track to re-record', async () => {
        const worker = await startAndArm('track-stall');

        stopAudioRecording();
        // Worker never posts the final `wav` — simulate the stall by advancing
        // past the bounded flush deadline with no reply.
        expect(worker.terminate).not.toHaveBeenCalled();
        vi.advanceTimersByTime(5_000);

        expect(worker.terminate).toHaveBeenCalledTimes(1);

        // The session was dropped, so the track is no longer wedged: a fresh
        // start is accepted (returns true) rather than early-returning false.
        const restart = await startAndArm('track-stall');
        expect(restart).toBeInstanceOf(FakeWorker);
    });

    it('does not force-terminate when the worker flushes within the deadline', async () => {
        const worker = await startAndArm('track-ok');

        stopAudioRecording();
        worker.emit({ type: 'wav', buffer: new ArrayBuffer(40) }); // ≤44 bytes → teardown path, decode skipped
        await Promise.resolve();

        // Worker flushed in time → terminated by the normal path, and the guard
        // timer was cleared (advancing time must not double-terminate).
        const callsAfterFlush = worker.terminate.mock.calls.length;
        vi.advanceTimersByTime(5_000);
        expect(worker.terminate.mock.calls.length).toBe(callsAfterFlush);
    });
});
