import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { runTransientOnsetWorker } from '../transientOnsetWorkerClient';

class ControlledWorker {
    static instances: ControlledWorker[] = [];
    onmessage: ((event: MessageEvent<unknown>) => void) | null = null;
    onerror: (() => void) | null = null;
    onmessageerror: (() => void) | null = null;
    terminate = vi.fn();
    posted: unknown;
    constructor() {
        ControlledWorker.instances.push(this);
    }
    postMessage(message: unknown, transfer: Transferable[]): void {
        this.posted = structuredClone(message, { transfer });
    }
}

describe('transient worker lifetime', () => {
    beforeEach(() => {
        ControlledWorker.instances = [];
        vi.stubGlobal('Worker', ControlledWorker);
    });
    afterEach(() => {
        vi.unstubAllGlobals();
        vi.useRealTimers();
    });

    it('transfers caller copies, validates numeric results after detachment and terminates on success', async () => {
        const channel = new Float32Array(2_048);
        const result = runTransientOnsetWorker({
            channels: [channel],
            sampleRate: 16_000,
            sensitivity: 0.5,
            timeoutMs: 100,
        });
        const worker = ControlledWorker.instances[0]!;
        expect(channel.byteLength).toBe(0);
        worker.onmessage?.(
            new MessageEvent('message', { data: { status: 'complete', hits: [{ sampleOffset: 512, confidence: 1 }] } })
        );
        expect(await result).toEqual({ status: 'complete', hits: [{ sampleOffset: 512, confidence: 1 }] });
        expect(worker.terminate).toHaveBeenCalledTimes(1);
        expect(worker.onmessage).toBeNull();
    });

    it.each(['abort', 'error', 'messageerror', 'timeout', 'invalid'] as const)(
        'terminates and releases callbacks on %s',
        async (kind) => {
            vi.useFakeTimers();
            const controller = new AbortController();
            const result = runTransientOnsetWorker({
                channels: [new Float32Array(2_048)],
                sampleRate: 16_000,
                sensitivity: 0.5,
                timeoutMs: 100,
                signal: controller.signal,
            });
            const worker = ControlledWorker.instances[0]!;
            if (kind === 'abort') controller.abort();
            if (kind === 'error') worker.onerror?.();
            if (kind === 'messageerror') worker.onmessageerror?.();
            if (kind === 'timeout') await vi.advanceTimersByTimeAsync(100);
            if (kind === 'invalid')
                worker.onmessage?.(
                    new MessageEvent('message', {
                        data: { status: 'complete', hits: [{ sampleOffset: -1, confidence: NaN }] },
                    })
                );
            expect(await result).toEqual({
                status: 'failed',
                code: kind === 'abort' ? 'cancelled' : kind === 'timeout' ? 'analysis-timed-out' : 'analysis-failed',
            });
            expect(worker.terminate).toHaveBeenCalledTimes(1);
            expect(worker.onmessage).toBeNull();
            expect(worker.onerror).toBeNull();
            expect(worker.onmessageerror).toBeNull();
            expect(vi.getTimerCount()).toBe(0);
        }
    );

    it('does not construct a worker after cancellation', async () => {
        const controller = new AbortController();
        controller.abort();
        expect(
            await runTransientOnsetWorker({
                channels: [],
                sampleRate: 16_000,
                sensitivity: 0.5,
                timeoutMs: 100,
                signal: controller.signal,
            })
        ).toEqual({ status: 'failed', code: 'cancelled' });
        expect(ControlledWorker.instances).toHaveLength(0);
    });
});
