import { afterEach, describe, expect, it, vi } from 'vitest';

import {
    createDecodedBankResource,
    type DecodedBank,
    type DecodedBankResource,
    type DecodedSample,
    type LoadDecodedBankInput,
} from '../createDecodedBankResource';

import type { InstrumentId } from '../../../models/LevainPatch';
import type { SampleManifest } from '../sampleManifest';

vi.mock('#/infra/logger/appLogger', () => ({
    logger: { warn: vi.fn() },
}));

class Deferred<T> {
    public readonly promise: Promise<T>;
    private resolvePromise: ((value: T) => void) | null = null;
    private rejectPromise: ((error: unknown) => void) | null = null;

    public constructor() {
        this.promise = new Promise<T>((resolve, reject) => {
            this.resolvePromise = resolve;
            this.rejectPromise = reject;
        });
    }

    public resolve(value: T): void {
        if (!this.resolvePromise) {
            throw new Error('Deferred resolve callback is unavailable');
        }
        this.resolvePromise(value);
    }

    public reject(error: unknown): void {
        if (!this.rejectPromise) {
            throw new Error('Deferred reject callback is unavailable');
        }
        this.rejectPromise(error);
    }
}

const DEFAULT_INPUT: LoadDecodedBankInput = {
    manifestUrl: '/samples/levain/violin-1/manifest.json',
    basePath: '/samples/levain/violin-1',
    expectedInstrumentId: 'violin-1',
    lod: { maxMics: 0, maxRoundRobins: 0 },
};

function createDeferred<T>(): Deferred<T> {
    return new Deferred<T>();
}

function createZone(file: string) {
    return {
        file,
        rootNote: 60,
        loKey: 0,
        hiKey: 127,
        loVel: 0,
        hiVel: 127,
        rrPos: 0,
        rrLen: 1,
        micId: 0,
        isRelease: false,
        loop: { mode: 'none' as const },
        gainDb: 0,
        attack: 0,
        decay: 0,
        sustain: 1,
        release: 0,
    };
}

function createManifest({
    articulationId = 0,
    files,
    instrumentId = 'violin-1',
}: {
    articulationId?: number;
    files: string[];
    instrumentId?: InstrumentId;
}): SampleManifest {
    return {
        version: 1,
        instrumentId,
        sampleRate: 48_000,
        micPositions: ['close'],
        articulations: [
            {
                type: 'sustain',
                id: articulationId,
                zones: files.map(createZone),
            },
        ],
        legatoTransitions: [],
    };
}

function createSample(value: number): DecodedSample {
    const buffer = new SharedArrayBuffer(Float32Array.BYTES_PER_ELEMENT);
    const data = new Float32Array(buffer);
    data[0] = value;
    return {
        data,
        frameCount: 1,
        channels: 1,
        sampleRate: 48_000,
    };
}

async function flushPromises(): Promise<void> {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
}

async function loadBank(
    resource: DecodedBankResource,
    input: LoadDecodedBankInput = DEFAULT_INPUT
): Promise<DecodedBank> {
    const lease = await resource.acquire(input);
    try {
        return lease.bank;
    } finally {
        lease.release();
    }
}

describe('createDecodedBankResource', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('deduplicates concurrent bank loads and returns one immutable bank object', async () => {
        const loadManifest = vi.fn().mockResolvedValue(createManifest({ files: ['a.wav'] }));
        const loadSample = vi.fn((_url: string, _signal: AbortSignal) => Promise.resolve(createSample(1)));
        const resource = createDecodedBankResource({
            maxDecodedBytes: 1024,
            maxConcurrentSampleLoads: 2,
            loadManifest,
            loadSample,
        });

        const [first, second] = await Promise.all([loadBank(resource), loadBank(resource)]);

        expect(first).toBe(second);
        expect(Object.isFrozen(first)).toBe(true);
        expect(loadManifest).toHaveBeenCalledTimes(1);
        expect(loadSample).toHaveBeenCalledTimes(1);
        expect(first.samples.get('a.wav')?.data.buffer).toBeInstanceOf(SharedArrayBuffer);
        expect(resource.getDiagnostics()).toMatchObject({
            cacheHits: 1,
            cacheMisses: 1,
            sampleLoads: 1,
            resolvedBanks: 1,
        });
    });

    it('publishes a new worklet bank identity after cache invalidation', async () => {
        const resource = createDecodedBankResource({
            maxDecodedBytes: 1024,
            maxConcurrentSampleLoads: 1,
            loadManifest: vi.fn().mockResolvedValue(createManifest({ files: ['a.wav'] })),
            loadSample: vi.fn().mockResolvedValue(createSample(1)),
        });

        const first = await loadBank(resource);
        resource.invalidate(DEFAULT_INPUT);
        const replacement = await loadBank(resource);

        expect(replacement.bankKey).not.toBe(first.bankKey);
    });

    it('sizes the DSP articulation lookup for sparse canonical articulation ids', async () => {
        const resource = createDecodedBankResource({
            maxDecodedBytes: 1024,
            maxConcurrentSampleLoads: 1,
            loadManifest: vi.fn().mockResolvedValue(createManifest({ articulationId: 13, files: ['a.wav'] })),
            loadSample: vi.fn().mockResolvedValue(createSample(1)),
        });

        await expect(loadBank(resource)).resolves.toMatchObject({ numArticulations: 14 });
    });

    it('bounds sample fetch and decode work across a bank', async () => {
        const deferredSamples = [
            createDeferred<DecodedSample>(),
            createDeferred<DecodedSample>(),
            createDeferred<DecodedSample>(),
        ];
        const loadSample = vi.fn((_url: string, _signal: AbortSignal) => {
            const deferred = deferredSamples[loadSample.mock.calls.length - 1];
            if (!deferred) {
                throw new Error('Unexpected sample load');
            }
            return deferred.promise;
        });
        const resource = createDecodedBankResource({
            maxDecodedBytes: 1024,
            maxConcurrentSampleLoads: 2,
            loadManifest: vi.fn().mockResolvedValue(createManifest({ files: ['a.wav', 'b.wav', 'c.wav'] })),
            loadSample,
        });

        const bankPromise = loadBank(resource);
        await flushPromises();

        expect(loadSample).toHaveBeenCalledTimes(2);

        deferredSamples[0]?.resolve(createSample(1));
        await flushPromises();

        expect(loadSample).toHaveBeenCalledTimes(3);

        deferredSamples[1]?.resolve(createSample(2));
        deferredSamples[2]?.resolve(createSample(3));
        await expect(bankPromise).resolves.toMatchObject({ decodedByteLength: 12 });
    });

    it('does not enqueue every file in a large bank before a worker is available', async () => {
        const firstSample = createDeferred<DecodedSample>();
        const secondSample = createDeferred<DecodedSample>();
        const files = Array.from({ length: 64 }, (_, index) => `sample-${index}.wav`);
        const loadSample = vi.fn(() => {
            if (loadSample.mock.calls.length === 1) {
                return firstSample.promise;
            }
            if (loadSample.mock.calls.length === 2) {
                return secondSample.promise;
            }
            return Promise.resolve(createSample(loadSample.mock.calls.length));
        });
        const resource = createDecodedBankResource({
            maxDecodedBytes: 1024,
            maxConcurrentSampleLoads: 2,
            loadManifest: vi.fn().mockResolvedValue(createManifest({ files })),
            loadSample,
        });

        const bankPromise = loadBank(resource);
        await flushPromises();

        expect(loadSample).toHaveBeenCalledTimes(2);
        expect(resource.getDiagnostics()).toMatchObject({ activeSampleLoads: 2, queuedSampleLoads: 0 });

        firstSample.resolve(createSample(1));
        secondSample.resolve(createSample(2));

        await expect(bankPromise).resolves.toMatchObject({ decodedByteLength: 256 });
        expect(loadSample).toHaveBeenCalledTimes(64);
        expect(resource.getDiagnostics()).toMatchObject({ activeSampleLoads: 0, queuedSampleLoads: 0 });
    });

    it('accounts decoded PCM incrementally while a bank is still loading', async () => {
        const firstSample = createDeferred<DecodedSample>();
        const secondSample = createDeferred<DecodedSample>();
        const samples = [firstSample, secondSample];
        const loadSample = vi.fn(() => {
            const sample = samples[loadSample.mock.calls.length - 1];
            if (!sample) {
                throw new Error('Unexpected sample load');
            }
            return sample.promise;
        });
        const resource = createDecodedBankResource({
            maxDecodedBytes: 8,
            maxConcurrentSampleLoads: 2,
            loadManifest: vi.fn().mockResolvedValue(createManifest({ files: ['a.wav', 'b.wav'] })),
            loadSample,
        });

        const bank = loadBank(resource);
        await flushPromises();
        firstSample.resolve(createSample(1));
        await flushPromises();

        expect(resource.getDiagnostics()).toMatchObject({ decodedBytes: 4, inFlightBanks: 1, resolvedBanks: 0 });

        secondSample.resolve(createSample(2));
        await expect(bank).resolves.toMatchObject({ decodedByteLength: 8 });
        expect(resource.getDiagnostics()).toMatchObject({ decodedBytes: 8, inFlightBanks: 0, resolvedBanks: 1 });
    });

    it('does not cancel shared loading when one consumer is superseded', async () => {
        const deferredSample = createDeferred<DecodedSample>();
        const resource = createDecodedBankResource({
            maxDecodedBytes: 1024,
            maxConcurrentSampleLoads: 2,
            loadManifest: vi.fn().mockResolvedValue(createManifest({ files: ['a.wav'] })),
            loadSample: vi.fn(() => deferredSample.promise),
        });
        const controller = new AbortController();

        const cancelledConsumer = loadBank(resource, { ...DEFAULT_INPUT, signal: controller.signal });
        const remainingConsumer = loadBank(resource);
        controller.abort();
        deferredSample.resolve(createSample(1));

        await expect(cancelledConsumer).rejects.toMatchObject({ name: 'AbortError' });
        await expect(remainingConsumer).resolves.toMatchObject({ decodedByteLength: 4 });
        expect(resource.getDiagnostics()).toMatchObject({ resolvedBanks: 1, failedBanks: 0 });
    });

    it('aborts an abandoned load when its last consumer is superseded', async () => {
        const observedSignals: AbortSignal[] = [];
        const loadManifest = vi.fn().mockResolvedValue(createManifest({ files: ['a.wav'] }));
        const resource = createDecodedBankResource({
            maxDecodedBytes: 1024,
            maxConcurrentSampleLoads: 1,
            loadManifest,
            loadSample: vi.fn((_url: string, signal: AbortSignal) => {
                observedSignals.push(signal);
                return new Promise<DecodedSample>((_resolve, reject) => {
                    signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), {
                        once: true,
                    });
                });
            }),
        });
        const controller = new AbortController();

        const abandoned = loadBank(resource, { ...DEFAULT_INPUT, signal: controller.signal });
        await flushPromises();
        controller.abort();

        await expect(abandoned).rejects.toMatchObject({ name: 'AbortError' });
        await flushPromises();
        expect(observedSignals[0]?.aborted).toBe(true);
        expect(resource.getDiagnostics()).toMatchObject({ inFlightBanks: 0, resolvedBanks: 0 });
        expect(loadManifest).toHaveBeenCalledTimes(1);
    });

    it('rejects a pre-aborted consumer without starting or touching a shared entry', async () => {
        const loadManifest = vi.fn().mockResolvedValue(createManifest({ files: ['a.wav'] }));
        const resource = createDecodedBankResource({
            maxDecodedBytes: 1024,
            maxConcurrentSampleLoads: 1,
            loadManifest,
            loadSample: vi.fn().mockResolvedValue(createSample(1)),
        });
        const controller = new AbortController();
        controller.abort();

        await expect(loadBank(resource, { ...DEFAULT_INPUT, signal: controller.signal })).rejects.toMatchObject({
            name: 'AbortError',
        });

        expect(loadManifest).not.toHaveBeenCalled();
        expect(resource.getDiagnostics()).toMatchObject({ cacheHits: 0, cacheMisses: 0, inFlightBanks: 0 });
    });

    it('observes cancellation triggered by the initial progress notification', async () => {
        const loadManifest = vi.fn().mockResolvedValue(createManifest({ files: ['a.wav'] }));
        const loadSample = vi.fn((_url: string, _signal: AbortSignal) => Promise.resolve(createSample(1)));
        const resource = createDecodedBankResource({
            maxDecodedBytes: 1024,
            maxConcurrentSampleLoads: 1,
            loadManifest,
            loadSample,
        });
        const controller = new AbortController();

        const cancelled = loadBank(resource, {
            ...DEFAULT_INPUT,
            signal: controller.signal,
            onProgress: () => controller.abort(),
        });

        await expect(cancelled).rejects.toMatchObject({ name: 'AbortError' });
        await flushPromises();
        expect(loadSample).toHaveBeenCalledTimes(1);
        const sampleCall = loadSample.mock.calls[0];
        if (!sampleCall) {
            throw new Error('Expected one aborted sample load');
        }
        expect(sampleCall[1].aborted).toBe(true);
        expect(resource.getDiagnostics()).toMatchObject({ inFlightBanks: 0, resolvedBanks: 0 });
    });

    it('isolates a throwing progress subscriber from the bank and other consumers', async () => {
        const healthyProgress = vi.fn();
        const resource = createDecodedBankResource({
            maxDecodedBytes: 1024,
            maxConcurrentSampleLoads: 1,
            loadManifest: vi.fn().mockResolvedValue(createManifest({ files: ['a.wav'] })),
            loadSample: vi.fn().mockResolvedValue(createSample(1)),
        });

        const throwingConsumer = loadBank(resource, {
            ...DEFAULT_INPUT,
            onProgress: () => {
                throw new Error('panel was disposed');
            },
        });
        const healthyConsumer = loadBank(resource, { ...DEFAULT_INPUT, onProgress: healthyProgress });

        await expect(throwingConsumer).resolves.toMatchObject({ decodedByteLength: 4 });
        await expect(healthyConsumer).resolves.toMatchObject({ decodedByteLength: 4 });
        expect(healthyProgress).toHaveBeenLastCalledWith(1);
        expect(resource.getDiagnostics()).toMatchObject({ failedBanks: 0, resolvedBanks: 1 });
    });

    it('removes a failed entry so a later request can retry explicitly', async () => {
        const loadSample = vi
            .fn()
            .mockRejectedValueOnce(new Error('decode failed'))
            .mockResolvedValueOnce(createSample(1));
        const loadManifest = vi.fn().mockResolvedValue(createManifest({ files: ['a.wav'] }));
        const resource = createDecodedBankResource({
            maxDecodedBytes: 1024,
            maxConcurrentSampleLoads: 1,
            loadManifest,
            loadSample,
        });

        await expect(loadBank(resource)).rejects.toThrow('decode failed');
        await expect(loadBank(resource)).resolves.toMatchObject({ decodedByteLength: 4 });

        expect(loadManifest).toHaveBeenCalledTimes(2);
        expect(loadSample).toHaveBeenCalledTimes(2);
        expect(resource.getDiagnostics()).toMatchObject({
            cacheMisses: 2,
            failedBanks: 1,
            resolvedBanks: 1,
        });
    });

    it('releases the global sample slot when a loader throws synchronously', async () => {
        const loadSample = vi
            .fn()
            .mockImplementationOnce(() => {
                throw new Error('synchronous decode failure');
            })
            .mockResolvedValueOnce(createSample(1));
        const resource = createDecodedBankResource({
            maxDecodedBytes: 1024,
            maxConcurrentSampleLoads: 1,
            loadManifest: vi.fn().mockResolvedValue(createManifest({ files: ['a.wav'] })),
            loadSample,
        });

        await expect(loadBank(resource)).rejects.toThrow('synchronous decode failure');
        expect(resource.getDiagnostics()).toMatchObject({ activeSampleLoads: 0, sampleLoadFailures: 1 });

        await expect(loadBank(resource)).resolves.toMatchObject({ decodedByteLength: 4 });
        expect(loadSample).toHaveBeenCalledTimes(2);
        expect(resource.getDiagnostics()).toMatchObject({ activeSampleLoads: 0, resolvedBanks: 1 });
    });

    it('removes a manifest entry when its loader throws synchronously', async () => {
        const loadManifest = vi
            .fn()
            .mockImplementationOnce(() => {
                throw new Error('synchronous manifest failure');
            })
            .mockResolvedValueOnce(createManifest({ files: ['a.wav'] }));
        const resource = createDecodedBankResource({
            maxDecodedBytes: 1024,
            maxConcurrentSampleLoads: 1,
            loadManifest,
            loadSample: vi.fn().mockResolvedValue(createSample(1)),
        });

        await expect(loadBank(resource)).rejects.toThrow('synchronous manifest failure');
        await expect(loadBank(resource)).resolves.toMatchObject({ decodedByteLength: 4 });

        expect(loadManifest).toHaveBeenCalledTimes(2);
        expect(resource.getDiagnostics()).toMatchObject({ manifestLoads: 2, resolvedBanks: 1 });
    });

    it('settles invalidated manifest consumers without allowing stale work to resurrect a bank', async () => {
        const manifest = createDeferred<SampleManifest>();
        const loadSample = vi.fn().mockResolvedValue(createSample(1));
        const resource = createDecodedBankResource({
            maxDecodedBytes: 1024,
            maxConcurrentSampleLoads: 1,
            loadManifest: vi.fn(() => manifest.promise),
            loadSample,
        });

        const staleLoad = loadBank(resource);
        await flushPromises();
        resource.invalidate(DEFAULT_INPUT);

        await expect(staleLoad).rejects.toMatchObject({ name: 'AbortError' });
        expect(loadSample).not.toHaveBeenCalled();
        expect(resource.getDiagnostics()).toMatchObject({ inFlightBanks: 0, resolvedBanks: 0 });

        manifest.resolve(createManifest({ files: ['a.wav'] }));
        await flushPromises();
        expect(loadSample).not.toHaveBeenCalled();
        expect(resource.getDiagnostics()).toMatchObject({ inFlightBanks: 0, resolvedBanks: 0 });
    });

    it('settles manifest consumers when clear aborts a loader that ignores its signal', async () => {
        const manifest = createDeferred<SampleManifest>();
        const loadSample = vi.fn().mockResolvedValue(createSample(1));
        const resource = createDecodedBankResource({
            maxDecodedBytes: 1024,
            maxConcurrentSampleLoads: 1,
            loadManifest: vi.fn(() => manifest.promise),
            loadSample,
        });

        const staleLoad = loadBank(resource);
        await flushPromises();
        resource.clear();

        await expect(staleLoad).rejects.toMatchObject({ name: 'AbortError' });
        expect(resource.getDiagnostics()).toMatchObject({ inFlightBanks: 0, resolvedBanks: 0 });

        manifest.resolve(createManifest({ files: ['a.wav'] }));
        await flushPromises();
        expect(loadSample).not.toHaveBeenCalled();
        expect(resource.getDiagnostics()).toMatchObject({ inFlightBanks: 0, resolvedBanks: 0 });
    });

    it('settles bank consumers while an invalidated sample loader finishes physically', async () => {
        const sample = createDeferred<DecodedSample>();
        const loadSample = vi.fn(() => sample.promise);
        const resource = createDecodedBankResource({
            maxDecodedBytes: 1024,
            maxConcurrentSampleLoads: 1,
            loadManifest: vi.fn().mockResolvedValue(createManifest({ files: ['a.wav'] })),
            loadSample,
        });

        const staleLoad = loadBank(resource);
        await flushPromises();
        resource.invalidate(DEFAULT_INPUT);

        await expect(staleLoad).rejects.toMatchObject({ name: 'AbortError' });
        expect(resource.getDiagnostics()).toMatchObject({
            activeSampleLoads: 1,
            inFlightBanks: 0,
            resolvedBanks: 0,
        });

        const retry = loadBank(resource);
        await flushPromises();
        expect(loadSample).toHaveBeenCalledTimes(1);
        expect(resource.getDiagnostics()).toMatchObject({ activeSampleLoads: 1, queuedSampleLoads: 1 });

        sample.resolve(createSample(1));
        await expect(retry).resolves.toMatchObject({ decodedByteLength: 4 });
        expect(loadSample).toHaveBeenCalledTimes(2);
        expect(resource.getDiagnostics()).toMatchObject({
            activeSampleLoads: 0,
            inFlightBanks: 0,
            queuedSampleLoads: 0,
            resolvedBanks: 1,
        });

        resource.invalidate(DEFAULT_INPUT);
        expect(resource.getDiagnostics()).toMatchObject({ decodedBytes: 0, resolvedBanks: 0 });
    });

    it('clears cancelled bank PCM before reusing its decoded-memory budget', async () => {
        const decodedSample = createDeferred<DecodedSample>();
        const pendingSample = createDeferred<DecodedSample>();
        const celloInput = {
            ...DEFAULT_INPUT,
            manifestUrl: '/samples/levain/cello/manifest.json',
            basePath: '/samples/levain/cello',
            expectedInstrumentId: 'cello',
        };
        const loadManifest = vi.fn((url: string) => {
            if (url.includes('cello')) {
                return Promise.resolve(createManifest({ files: ['cello.wav'], instrumentId: 'cello' }));
            }
            return Promise.resolve(createManifest({ files: ['decoded.wav', 'pending.wav'] }));
        });
        const loadSample = vi.fn((url: string) => {
            if (url.includes('decoded.wav')) {
                return decodedSample.promise;
            }
            if (url.includes('pending.wav')) {
                return pendingSample.promise;
            }
            return Promise.resolve(createSample(1));
        });
        const resource = createDecodedBankResource({
            maxDecodedBytes: 4,
            maxConcurrentSampleLoads: 2,
            loadManifest,
            loadSample,
        });

        const cancelledLoad = loadBank(resource);
        await flushPromises();
        expect(resource.getDiagnostics()).toMatchObject({ activeSampleLoads: 2, decodedBytes: 0, inFlightBanks: 1 });

        decodedSample.resolve(createSample(1));
        await flushPromises();
        expect(resource.getDiagnostics()).toMatchObject({ activeSampleLoads: 1, decodedBytes: 4, inFlightBanks: 1 });

        resource.invalidate(DEFAULT_INPUT);
        await expect(cancelledLoad).rejects.toMatchObject({ name: 'AbortError' });
        expect(resource.getDiagnostics()).toMatchObject({ activeSampleLoads: 1, decodedBytes: 0, inFlightBanks: 0 });

        await expect(loadBank(resource, celloInput)).resolves.toMatchObject({ decodedByteLength: 4 });
        expect(resource.getDiagnostics()).toMatchObject({ activeSampleLoads: 1, decodedBytes: 4, resolvedBanks: 1 });

        pendingSample.resolve(createSample(2));
        await flushPromises();
        expect(resource.getDiagnostics()).toMatchObject({ activeSampleLoads: 0, decodedBytes: 4, resolvedBanks: 1 });
    });

    it('rejects a manifest whose identity does not match the requested instrument', async () => {
        const loadSample = vi.fn().mockResolvedValue(createSample(1));
        const resource = createDecodedBankResource({
            maxDecodedBytes: 1024,
            maxConcurrentSampleLoads: 1,
            loadManifest: vi.fn().mockResolvedValue(createManifest({ files: ['cello.wav'], instrumentId: 'cello' })),
            loadSample,
        });

        await expect(loadBank(resource)).rejects.toThrow(
            'Levain manifest instrument cello does not match requested violin-1'
        );

        expect(loadSample).not.toHaveBeenCalled();
        expect(resource.getDiagnostics()).toMatchObject({ cacheMisses: 0, inFlightBanks: 0, resolvedBanks: 0 });
    });

    it('evicts least-recently-used decoded banks by byte weight', async () => {
        const loadManifest = vi.fn((url: string) => {
            const instrumentId = url.includes('violin') ? 'violin-1' : 'cello';
            return Promise.resolve(createManifest({ files: [`${instrumentId}.wav`], instrumentId }));
        });
        const resource = createDecodedBankResource({
            maxDecodedBytes: 4,
            maxConcurrentSampleLoads: 1,
            loadManifest,
            loadSample: vi.fn().mockResolvedValue(createSample(1)),
        });
        const celloInput = {
            ...DEFAULT_INPUT,
            manifestUrl: '/samples/levain/cello/manifest.json',
            basePath: '/samples/levain/cello',
            expectedInstrumentId: 'cello',
        };

        await loadBank(resource);
        await loadBank(resource, celloInput);
        await loadBank(resource);

        expect(loadManifest).toHaveBeenCalledTimes(3);
        expect(resource.getDiagnostics()).toMatchObject({
            evictions: 2,
            decodedBytes: 4,
            resolvedBanks: 1,
        });
    });

    it('does not evict a decoded bank while a consumer still owns its samples', async () => {
        const loadManifest = vi.fn((url: string) => {
            const instrumentId = url.includes('violin') ? 'violin-1' : 'cello';
            return Promise.resolve(createManifest({ files: [`${instrumentId}.wav`], instrumentId }));
        });
        const resource = createDecodedBankResource({
            maxDecodedBytes: 4,
            maxConcurrentSampleLoads: 1,
            loadManifest,
            loadSample: vi.fn().mockResolvedValue(createSample(1)),
        });
        const celloInput = {
            ...DEFAULT_INPUT,
            manifestUrl: '/samples/levain/cello/manifest.json',
            basePath: '/samples/levain/cello',
            expectedInstrumentId: 'cello',
        };

        const heldLease = await resource.acquire(DEFAULT_INPUT);

        await expect(loadBank(resource, celloInput)).rejects.toThrow('Levain decoded-bank memory budget exceeded');
        expect(heldLease.bank.samples.size).toBe(1);
        expect(resource.getDiagnostics()).toMatchObject({ activeLeases: 1, decodedBytes: 4, resolvedBanks: 1 });
        heldLease.release();
    });

    it('keeps retired PCM accounted until the final lease is released', async () => {
        const resource = createDecodedBankResource({
            maxDecodedBytes: 4,
            maxConcurrentSampleLoads: 1,
            loadManifest: vi.fn().mockResolvedValue(createManifest({ files: ['violin-1.wav'] })),
            loadSample: vi.fn().mockResolvedValue(createSample(1)),
        });
        const [firstLease, secondLease] = await Promise.all([
            resource.acquire(DEFAULT_INPUT),
            resource.acquire(DEFAULT_INPUT),
        ]);

        resource.clear();

        expect(resource.getDiagnostics()).toMatchObject({ activeLeases: 2, decodedBytes: 4, resolvedBanks: 0 });
        firstLease.release();
        expect(resource.getDiagnostics()).toMatchObject({ activeLeases: 1, decodedBytes: 4, resolvedBanks: 0 });
        secondLease.release();
        expect(resource.getDiagnostics()).toMatchObject({ activeLeases: 0, decodedBytes: 0, resolvedBanks: 0 });
    });

    it('keeps the newer bank when an older in-flight request resolves last', async () => {
        const violinSample = createDeferred<DecodedSample>();
        const celloSample = createDeferred<DecodedSample>();
        const loadManifest = vi.fn((url: string) => {
            const instrumentId = url.includes('violin') ? 'violin-1' : 'cello';
            return Promise.resolve(createManifest({ files: [`${instrumentId}.wav`], instrumentId }));
        });
        const loadSample = vi.fn((url: string) => {
            if (loadSample.mock.calls.length > 2) {
                return Promise.resolve(createSample(3));
            }
            return url.includes('violin') ? violinSample.promise : celloSample.promise;
        });
        const resource = createDecodedBankResource({
            maxDecodedBytes: 4,
            maxConcurrentSampleLoads: 2,
            loadManifest,
            loadSample,
        });
        const celloInput = {
            ...DEFAULT_INPUT,
            manifestUrl: '/samples/levain/cello/manifest.json',
            basePath: '/samples/levain/cello',
            expectedInstrumentId: 'cello',
        };

        const violinLoad = loadBank(resource);
        const celloLoad = loadBank(resource, celloInput);
        await flushPromises();
        celloSample.resolve(createSample(2));
        await celloLoad;
        violinSample.resolve(createSample(1));
        await expect(violinLoad).rejects.toThrow('Levain decoded-bank memory budget exceeded');

        await loadBank(resource, celloInput);
        expect(resource.getDiagnostics()).toMatchObject({ evictions: 0, failedBanks: 1, resolvedBanks: 1 });

        await loadBank(resource);

        const manifestUrls = loadManifest.mock.calls.map(([url]) => url);
        expect(manifestUrls.filter((url) => url.includes('cello'))).toHaveLength(2);
        expect(manifestUrls.filter((url) => url.includes('violin'))).toHaveLength(2);
        const sampleUrls = loadSample.mock.calls.map(([url]) => url);
        expect(sampleUrls.filter((url) => url.includes('cello'))).toHaveLength(1);
        expect(sampleUrls.filter((url) => url.includes('violin'))).toHaveLength(2);
        expect(resource.getDiagnostics()).toMatchObject({ evictions: 1, failedBanks: 1, resolvedBanks: 1 });
    });

    it('rejects a bank that exceeds the decoded-memory budget', async () => {
        const loadManifest = vi.fn().mockResolvedValue(createManifest({ files: ['oversized.wav'] }));
        const resource = createDecodedBankResource({
            maxDecodedBytes: 3,
            maxConcurrentSampleLoads: 1,
            loadManifest,
            loadSample: vi.fn().mockResolvedValue(createSample(1)),
        });

        await expect(loadBank(resource)).rejects.toThrow('Levain decoded-bank memory budget exceeded');

        expect(loadManifest).toHaveBeenCalledTimes(1);
        expect(resource.getDiagnostics()).toMatchObject({
            decodedBytes: 0,
            failedBanks: 1,
            resolvedBanks: 0,
        });
    });

    it('revalidates a same-URL manifest after explicit invalidation', async () => {
        const loadManifest = vi
            .fn()
            .mockResolvedValueOnce(createManifest({ files: ['first.wav'] }))
            .mockResolvedValueOnce(createManifest({ files: ['replacement.wav'] }));
        const resource = createDecodedBankResource({
            maxDecodedBytes: 1024,
            maxConcurrentSampleLoads: 1,
            loadManifest,
            loadSample: vi.fn().mockResolvedValue(createSample(1)),
        });

        const first = await loadBank(resource);
        resource.invalidate(DEFAULT_INPUT);
        const second = await loadBank(resource);

        expect(first.files).toEqual(['first.wav']);
        expect(second.files).toEqual(['replacement.wav']);
        expect(loadManifest).toHaveBeenCalledTimes(2);
        expect(resource.getDiagnostics()).toMatchObject({ resolvedBanks: 1 });
    });
});
