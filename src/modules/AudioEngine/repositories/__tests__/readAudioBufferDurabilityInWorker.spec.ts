import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { readAudioBufferDurabilityInWorker } from '../readAudioBufferDurabilityInWorker';

class FakeWorker {
    static current: FakeWorker;
    onmessage: ((event: MessageEvent<unknown>) => void) | null = null;
    onerror: (() => void) | null = null;
    onmessageerror: (() => void) | null = null;
    readonly postMessage = vi.fn<(request: unknown) => void>();
    readonly terminate = vi.fn<() => void>();

    constructor(readonly url: URL) {
        FakeWorker.current = this;
    }

    answer(data: unknown): void {
        this.onmessage?.(new MessageEvent('message', { data }));
    }
}

function expectCleanedUp(worker: FakeWorker): void {
    expect(worker.terminate).toHaveBeenCalledOnce();
    expect(worker.onmessage).toBeNull();
    expect(worker.onerror).toBeNull();
    expect(worker.onmessageerror).toBeNull();
}

describe('readAudioBufferDurabilityInWorker', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.stubGlobal('Worker', FakeWorker);
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.unstubAllGlobals();
    });

    it('sends the ordered IDs and returns only the exact revision or null for each ID', async () => {
        const reading = readAudioBufferDurabilityInWorker(['second', 'first']);
        const worker = FakeWorker.current;
        expect(worker.url.pathname).toMatch(/\/audioBufferDurabilityWorker\.ts$/);
        expect(worker.postMessage).toHaveBeenCalledExactlyOnceWith({ ids: ['second', 'first'] });
        worker.answer({ status: 'complete', revisions: ['revision-second', null] });

        await expect(reading).resolves.toEqual(['revision-second', null]);
        expectCleanedUp(worker);
        expect(vi.getTimerCount()).toBe(0);
    });

    it.each([
        { status: 'complete', revisions: [] },
        { status: 'complete', revisions: [''] },
        { status: 'complete', revisions: [4] },
        { status: 'failed' },
        { status: 'unavailable', revisions: [] },
    ])('rejects incomplete, malformed, or refused replies', async (reply) => {
        const reading = readAudioBufferDurabilityInWorker(['buffer']);
        const worker = FakeWorker.current;
        worker.answer(reply);

        await expect(reading).rejects.toThrow('did not return the requested revisions');
        expectCleanedUp(worker);
        expect(vi.getTimerCount()).toBe(0);
    });

    it('permits a renderer read only for unavailable capability', async () => {
        const reading = readAudioBufferDurabilityInWorker(['buffer']);
        const worker = FakeWorker.current;
        worker.answer({ status: 'unavailable' });
        await expect(reading).resolves.toBeUndefined();
        expectCleanedUp(worker);

        vi.stubGlobal('Worker', undefined);
        await expect(readAudioBufferDurabilityInWorker(['buffer'])).resolves.toBeUndefined();
        await expect(readAudioBufferDurabilityInWorker([])).resolves.toEqual([]);
    });

    it('distinguishes a disabled Worker from a construction failure', async () => {
        vi.stubGlobal(
            'Worker',
            class {
                constructor() {
                    throw new DOMException('Worker policy blocked it', 'SecurityError');
                }
            }
        );
        await expect(readAudioBufferDurabilityInWorker(['buffer'])).resolves.toBeUndefined();

        vi.stubGlobal(
            'Worker',
            class {
                constructor() {
                    throw new Error('failed to construct');
                }
            }
        );
        await expect(readAudioBufferDurabilityInWorker(['buffer'])).rejects.toThrow('failed to construct');
    });

    it.each(['onerror', 'onmessageerror'] as const)('fails and terminates on %s', async (handler) => {
        const reading = readAudioBufferDurabilityInWorker(['buffer']);
        const worker = FakeWorker.current;
        worker[handler]?.();

        await expect(reading).rejects.toThrow('Audio durability worker');
        expectCleanedUp(worker);
        expect(vi.getTimerCount()).toBe(0);
    });

    it('bounds an unresponsive worker and clears the handler for late replies', async () => {
        const reading = readAudioBufferDurabilityInWorker(['buffer']);
        const worker = FakeWorker.current;
        const rejection = expect(reading).rejects.toThrow('Audio durability worker timed out');

        await vi.runOnlyPendingTimersAsync();
        await rejection;
        expectCleanedUp(worker);
        expect(vi.getTimerCount()).toBe(0);
    });
});
