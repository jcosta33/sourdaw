import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { runFactorySynthesisWorker } from '../factorySynthesisWorkerClient';

class ControlledWorker {
    static instances: ControlledWorker[] = [];
    onmessage: ((event: MessageEvent<unknown>) => void) | null = null;
    onerror: (() => void) | null = null;
    onmessageerror: (() => void) | null = null;
    terminate = vi.fn();
    posted: unknown[] = [];
    constructor() {
        ControlledWorker.instances.push(this);
    }
    postMessage(message: unknown): void {
        this.posted.push(message);
    }
}

function validSample(id: string, channels: Float32Array[] = [new Float32Array([0.25, -0.5])]) {
    return { id, name: `Sample ${id}`, category: 'drums', tags: ['factory'], channels, sampleRate: 44100 };
}

function reply(samples: unknown): MessageEvent<unknown> {
    return new MessageEvent('message', { data: { status: 'complete', samples } });
}

describe('factory synthesis worker client', () => {
    beforeEach(() => {
        ControlledWorker.instances = [];
        vi.stubGlobal('Worker', ControlledWorker);
    });
    afterEach(() => {
        vi.unstubAllGlobals();
        vi.useRealTimers();
    });

    it('requests a render, returns the validated samples and terminates on success', async () => {
        const result = runFactorySynthesisWorker({ timeoutMs: 100 });
        const worker = ControlledWorker.instances[0]!;
        expect(worker.posted).toEqual([{ type: 'render' }]);
        const left = new Float32Array([0.1, 0.2]);
        const right = new Float32Array([0.3, 0.4]);
        worker.onmessage?.(reply([validSample('a'), { ...validSample('b', [left, right]), pitch: 48 }]));

        const settled = await result;

        expect(settled.status).toBe('complete');
        if (settled.status !== 'complete') {
            return;
        }
        expect(settled.samples.map((sample) => sample.id)).toEqual(['a', 'b']);
        expect(settled.samples[1]!.channels[0]).toBe(left);
        expect(settled.samples[1]!.channels[1]).toBe(right);
        expect(settled.samples[1]!.pitch).toBe(48);
        expect(worker.terminate).toHaveBeenCalledTimes(1);
        expect(worker.onmessage).toBeNull();
    });

    it.each([
        ['an empty sample list', []],
        ['a channel that is not Float32Array', [validSample('a', [new Float64Array(2) as unknown as Float32Array])]],
        ['channels of unequal length', [validSample('a', [new Float32Array(2), new Float32Array(3)])]],
        ['an empty channel', [validSample('a', [new Float32Array(0)])]],
        ['no channels', [validSample('a', [])]],
        ['more than two channels', [validSample('a', [new Float32Array(2), new Float32Array(2), new Float32Array(2)])]],
        ['a non-finite sample rate', [{ ...validSample('a'), sampleRate: Number.NaN }]],
        ['a zero sample rate', [{ ...validSample('a'), sampleRate: 0 }]],
        ['an empty id', [validSample('')]],
        ['a duplicate id', [validSample('a'), validSample('a')]],
        ['an unknown category', [{ ...validSample('a'), category: 'vocals' }]],
        ['a non-string tag', [{ ...validSample('a'), tags: [1] }]],
        ['a non-finite pitch', [{ ...validSample('a'), pitch: Number.POSITIVE_INFINITY }]],
        ['too many samples', Array.from({ length: 513 }, (_, index) => validSample(String(index)))],
    ])('refuses a reply with %s', async (_label, samples) => {
        const result = runFactorySynthesisWorker({ timeoutMs: 100 });
        const worker = ControlledWorker.instances[0]!;
        worker.onmessage?.(reply(samples));

        expect(await result).toEqual({ status: 'failed', code: 'render-failed' });
        expect(worker.terminate).toHaveBeenCalledTimes(1);
    });

    it.each(['error', 'messageerror', 'timeout', 'failed-reply'] as const)(
        'terminates and releases callbacks on %s',
        async (kind) => {
            vi.useFakeTimers();
            const result = runFactorySynthesisWorker({ timeoutMs: 100 });
            const worker = ControlledWorker.instances[0]!;
            if (kind === 'error') {
                worker.onerror?.();
            }
            if (kind === 'messageerror') {
                worker.onmessageerror?.();
            }
            if (kind === 'timeout') {
                await vi.advanceTimersByTimeAsync(100);
            }
            if (kind === 'failed-reply') {
                worker.onmessage?.(new MessageEvent('message', { data: { status: 'failed' } }));
            }

            expect(await result).toEqual({
                status: 'failed',
                code: kind === 'timeout' ? 'render-timed-out' : 'render-failed',
            });
            expect(worker.terminate).toHaveBeenCalledTimes(1);
            expect(worker.onmessage).toBeNull();
            expect(worker.onerror).toBeNull();
            expect(worker.onmessageerror).toBeNull();
            expect(vi.getTimerCount()).toBe(0);
        }
    );

    it('reports a typed failure when the Worker cannot be constructed', async () => {
        vi.stubGlobal(
            'Worker',
            class {
                constructor() {
                    throw new Error('workers unavailable');
                }
            }
        );

        expect(await runFactorySynthesisWorker({ timeoutMs: 100 })).toEqual({
            status: 'failed',
            code: 'render-failed',
        });
    });
});
