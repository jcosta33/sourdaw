import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { readAudioBufferDurabilityInWorker } from '../readAudioBufferDurabilityInWorker';

import type { AudioBufferDurabilityRequest, AudioBufferDurabilityResponse } from '../../models/AudioBufferDurability';

class FakeWorker {
    static latest: FakeWorker | undefined;
    onmessage: ((event: MessageEvent<AudioBufferDurabilityResponse>) => void) | null = null;
    onerror: ((event: ErrorEvent) => void) | null = null;
    onmessageerror: ((event: MessageEvent<unknown>) => void) | null = null;
    readonly posted: AudioBufferDurabilityRequest[] = [];
    readonly terminate = vi.fn();

    constructor(
        readonly url: URL,
        readonly options: WorkerOptions
    ) {
        FakeWorker.latest = this;
    }

    postMessage(request: AudioBufferDurabilityRequest): void {
        this.posted.push(request);
    }

    answer(data: AudioBufferDurabilityResponse): void {
        this.onmessage?.(new MessageEvent('message', { data }));
    }
}

function startedWorker(): FakeWorker {
    const worker = FakeWorker.latest;
    if (worker === undefined) {
        throw new Error('Expected one audio durability Worker to start');
    }
    return worker;
}

function expectReleased(worker: FakeWorker): void {
    expect(worker.terminate).toHaveBeenCalledOnce();
    expect(worker.onmessage).toBeNull();
    expect(worker.onerror).toBeNull();
    expect(worker.onmessageerror).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
}

describe('readAudioBufferDurabilityInWorker', () => {
    beforeEach(() => {
        FakeWorker.latest = undefined;
        vi.stubGlobal('Worker', FakeWorker);
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
        vi.useRealTimers();
    });

    it('posts the ordered IDs to the module Worker and returns the matching revisions', async () => {
        const ids = ['source-z', 'source-missing', 'source-a'];
        const pending = readAudioBufferDurabilityInWorker(ids);
        const worker = startedWorker();

        expect(worker.url.pathname).toMatch(/\/workers\/audioBufferDurabilityWorker\.ts$/u);
        expect(worker.options).toEqual({ type: 'module' });
        expect(worker.posted).toEqual([{ ids: ['source-z', 'source-missing', 'source-a'] }]);
        expect(vi.getTimerCount()).toBe(1);

        worker.answer({ status: 'complete', revisions: ['revision-z', null, 'revision-a'] });

        await expect(pending).resolves.toStrictEqual(['revision-z', null, 'revision-a']);
        expectReleased(worker);
    });

    it('allows the caller to fall back when the platform lacks Workers', async () => {
        vi.stubGlobal('Worker', undefined);

        await expect(readAudioBufferDurabilityInWorker(['source'])).resolves.toBeUndefined();
        expect(FakeWorker.latest).toBeUndefined();
        expect(vi.getTimerCount()).toBe(0);
    });

    it('allows fallback when the Worker reports storage is unavailable', async () => {
        const pending = readAudioBufferDurabilityInWorker(['source']);
        const worker = startedWorker();

        worker.answer({ status: 'unavailable' });

        await expect(pending).resolves.toBeUndefined();
        expectReleased(worker);
    });

    it('allows fallback when the Worker script fails to load', async () => {
        const pending = readAudioBufferDurabilityInWorker(['source']);
        const worker = startedWorker();

        worker.onerror?.(new ErrorEvent('error', { message: 'Worker script could not be loaded' }));

        await expect(pending).resolves.toBeUndefined();
        expectReleased(worker);
    });

    it('rejects an operation that failed inside the Worker', async () => {
        const pending = readAudioBufferDurabilityInWorker(['source']);
        const worker = startedWorker();

        worker.answer({ status: 'failed' });

        await expect(pending).rejects.toThrow('Audio buffer durability Worker did not complete its read');
        expectReleased(worker);
    });

    it('rejects when the browser cannot deserialize the response', async () => {
        const pending = readAudioBufferDurabilityInWorker(['source']);
        const worker = startedWorker();

        worker.onmessageerror?.(new MessageEvent('messageerror'));

        await expect(pending).rejects.toThrow('Audio buffer durability Worker returned an unreadable result');
        expectReleased(worker);
    });

    it('rejects and releases an operation that could not post its request', async () => {
        vi.spyOn(FakeWorker.prototype, 'postMessage').mockImplementationOnce(() => {
            throw new DOMException('The Worker could not accept the request', 'InvalidStateError');
        });

        await expect(readAudioBufferDurabilityInWorker(['source'])).rejects.toThrow(
            'Audio buffer durability Worker could not start its read'
        );
        expectReleased(startedWorker());
    });

    it('releases an unanswered read at its deadline', async () => {
        const pending = readAudioBufferDurabilityInWorker(['source']);
        const worker = startedWorker();
        const failure = expect(pending).rejects.toThrow('Audio buffer durability Worker timed out');

        await vi.advanceTimersByTimeAsync(29_999);
        expect(worker.terminate).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(1);

        await failure;
        expectReleased(worker);
    });
});
