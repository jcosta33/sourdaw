import { afterEach, describe, expect, it, vi } from 'vitest';

import { createDecodedBankResource, type DecodedSample, type LoadDecodedBankInput } from '../createDecodedBankResource';

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
        loopMode: 'none' as const,
        loopStart: 0,
        loopEnd: 0,
        loopCrossfade: 0,
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
    version = 1,
}: {
    articulationId?: number;
    files: string[];
    instrumentId?: string;
    version?: number;
}): SampleManifest {
    return {
        version,
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

        const [first, second] = await Promise.all([resource.load(DEFAULT_INPUT), resource.load(DEFAULT_INPUT)]);

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

    it('sizes the DSP articulation lookup for sparse canonical articulation ids', async () => {
        const resource = createDecodedBankResource({
            maxDecodedBytes: 1024,
            maxConcurrentSampleLoads: 1,
            loadManifest: vi.fn().mockResolvedValue(createManifest({ articulationId: 13, files: ['a.wav'] })),
            loadSample: vi.fn().mockResolvedValue(createSample(1)),
        });

        await expect(resource.load(DEFAULT_INPUT)).resolves.toMatchObject({ numArticulations: 14 });
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

        const bankPromise = resource.load(DEFAULT_INPUT);
        await flushPromises();

        expect(loadSample).toHaveBeenCalledTimes(2);

        deferredSamples[0]?.resolve(createSample(1));
        await flushPromises();

        expect(loadSample).toHaveBeenCalledTimes(3);

        deferredSamples[1]?.resolve(createSample(2));
        deferredSamples[2]?.resolve(createSample(3));
        await expect(bankPromise).resolves.toMatchObject({ decodedByteLength: 12 });
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

        const bank = resource.load(DEFAULT_INPUT);
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

        const cancelledConsumer = resource.load({ ...DEFAULT_INPUT, signal: controller.signal });
        const remainingConsumer = resource.load(DEFAULT_INPUT);
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

        const abandoned = resource.load({ ...DEFAULT_INPUT, signal: controller.signal });
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

        await expect(resource.load({ ...DEFAULT_INPUT, signal: controller.signal })).rejects.toMatchObject({
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

        const cancelled = resource.load({
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

        const throwingConsumer = resource.load({
            ...DEFAULT_INPUT,
            onProgress: () => {
                throw new Error('panel was disposed');
            },
        });
        const healthyConsumer = resource.load({ ...DEFAULT_INPUT, onProgress: healthyProgress });

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

        await expect(resource.load(DEFAULT_INPUT)).rejects.toThrow('decode failed');
        await expect(resource.load(DEFAULT_INPUT)).resolves.toMatchObject({ decodedByteLength: 4 });

        expect(loadManifest).toHaveBeenCalledTimes(2);
        expect(loadSample).toHaveBeenCalledTimes(2);
        expect(resource.getDiagnostics()).toMatchObject({
            cacheMisses: 2,
            failedBanks: 1,
            resolvedBanks: 1,
        });
    });

    it('rejects a manifest whose identity does not match the requested instrument', async () => {
        const loadSample = vi.fn().mockResolvedValue(createSample(1));
        const resource = createDecodedBankResource({
            maxDecodedBytes: 1024,
            maxConcurrentSampleLoads: 1,
            loadManifest: vi.fn().mockResolvedValue(createManifest({ files: ['cello.wav'], instrumentId: 'cello' })),
            loadSample,
        });

        await expect(resource.load(DEFAULT_INPUT)).rejects.toThrow(
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

        await resource.load(DEFAULT_INPUT);
        await resource.load(celloInput);
        await resource.load(DEFAULT_INPUT);

        expect(loadManifest).toHaveBeenCalledTimes(3);
        expect(resource.getDiagnostics()).toMatchObject({
            evictions: 2,
            decodedBytes: 4,
            resolvedBanks: 1,
        });
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

        const violinLoad = resource.load(DEFAULT_INPUT);
        const celloLoad = resource.load(celloInput);
        await flushPromises();
        celloSample.resolve(createSample(2));
        await celloLoad;
        violinSample.resolve(createSample(1));
        await expect(violinLoad).rejects.toThrow('Levain decoded-bank memory budget exceeded');

        await resource.load(celloInput);
        expect(resource.getDiagnostics()).toMatchObject({ evictions: 0, failedBanks: 1, resolvedBanks: 1 });

        await resource.load(DEFAULT_INPUT);

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

        await expect(resource.load(DEFAULT_INPUT)).rejects.toThrow('Levain decoded-bank memory budget exceeded');

        expect(loadManifest).toHaveBeenCalledTimes(1);
        expect(resource.getDiagnostics()).toMatchObject({
            decodedBytes: 0,
            failedBanks: 1,
            resolvedBanks: 0,
        });
    });

    it('revalidates a same-URL manifest and replaces an older decoded version', async () => {
        const loadManifest = vi
            .fn()
            .mockResolvedValueOnce(createManifest({ files: ['v1.wav'], version: 1 }))
            .mockResolvedValueOnce(createManifest({ files: ['v2.wav'], version: 2 }));
        const resource = createDecodedBankResource({
            maxDecodedBytes: 1024,
            maxConcurrentSampleLoads: 1,
            loadManifest,
            loadSample: vi.fn().mockResolvedValue(createSample(1)),
        });

        const first = await resource.load(DEFAULT_INPUT);
        const second = await resource.load(DEFAULT_INPUT);

        expect(first.version).toBe(1);
        expect(second.version).toBe(2);
        expect(loadManifest).toHaveBeenCalledTimes(2);
        expect(resource.getDiagnostics()).toMatchObject({ resolvedBanks: 1 });
    });
});
