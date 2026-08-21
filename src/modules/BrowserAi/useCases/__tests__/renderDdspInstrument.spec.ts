import { beforeEach, describe, expect, it, vi } from 'vitest';

import { injectDependencies } from '#/infra/di/testing/injectDependencies';

const inferenceWorkerBridge = vi.hoisted(() => ({
    loadDdspSession: vi.fn(),
    runDdspInference: vi.fn(),
}));

vi.mock('../../repositories/inferenceWorkerBridge', () => ({ inferenceWorkerBridge }));

import { inferenceProgressStore } from '../../stores/inferenceProgressStore';
import { renderQueueStore } from '../../stores/renderQueueStore';
import { renderDdspInstrument } from '../renderDdspInstrument';

type Deferred<T> = {
    promise: Promise<T>;
    resolve: (value: T) => void;
    reject: (reason: unknown) => void;
};

function deferred<T>(): Deferred<T> {
    let resolveDeferred: (value: T) => void = () => undefined;
    let rejectDeferred: (reason: unknown) => void = () => undefined;
    const promise = new Promise<T>((resolve, reject) => {
        resolveDeferred = resolve;
        rejectDeferred = reject;
    });
    return { promise, resolve: resolveDeferred, reject: rejectDeferred };
}

function result(sample = 0.25) {
    return {
        type: 'ddsp-result' as const,
        requestId: 'worker-request',
        audio: new Float32Array(1_000).fill(sample),
        nativeSampleRate: 44_100,
        backend: 'webgpu' as const,
    };
}

function expectAdmittedDdspProvenance(rendered: Awaited<ReturnType<typeof renderDdspInstrument>>): void {
    expect(rendered.provenance).toEqual({
        modelId: 'ddsp-violin',
        renderQuality: 'standard',
        renderedAt: expect.any(Number),
        tier: 'browser-preview',
    });
    expect(Number.isFinite(rendered.provenance.renderedAt)).toBe(true);
}

const REQUEST_A = '00000000-0000-4000-8000-00000000000a';
const REQUEST_B = '00000000-0000-4000-8000-00000000000b';

describe('renderDdspInstrument request ownership', () => {
    const computeRenderCacheKey = vi.fn().mockResolvedValue('cache-key');
    const readRenderCache = vi.fn().mockResolvedValue(null);
    const writeRenderCache = vi.fn().mockResolvedValue(undefined);
    const checkDdspInstrumentReady = vi.fn().mockResolvedValue(true);
    const withDdspInstrumentLock = vi.fn(
        (_id: string, _mode: 'shared' | 'exclusive', operation: () => Promise<unknown>) => operation()
    );
    const logger = {
        debug: vi.fn(),
        error: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
    };

    const launch = (pitch: number, signal?: AbortSignal) =>
        renderDdspInstrument({
            phraseId: 'phrase-A',
            instrumentId: 'ddsp-violin',
            durationSec: 1,
            notes: [{ pitch, velocity: 100, startSec: 0, durationSec: 0.5 }],
            signal,
        });

    beforeEach(() => {
        vi.restoreAllMocks();
        readRenderCache.mockReset().mockResolvedValue(null);
        computeRenderCacheKey.mockReset().mockResolvedValue('cache-key');
        writeRenderCache.mockReset().mockResolvedValue(undefined);
        checkDdspInstrumentReady.mockReset().mockResolvedValue(true);
        withDdspInstrumentLock.mockClear();
        inferenceWorkerBridge.loadDdspSession.mockReset().mockResolvedValue('webgpu');
        inferenceWorkerBridge.runDdspInference.mockReset();
        inferenceProgressStore.set({ activeRenders: {} });
        renderQueueStore.set({ entries: [], cachedPhraseIds: [], phraseStatusMap: {} });
        injectDependencies(renderDdspInstrument, {
            logger,
            computeRenderCacheKey,
            readRenderCache,
            writeRenderCache,
            ddspModelStorage: { checkDdspInstrumentReady },
            inferenceWorkerBridge,
            withDdspInstrumentLock,
        });
    });

    it('returns the confirmed runtime backend and uses the versioned model key end to end', async () => {
        inferenceWorkerBridge.runDdspInference.mockResolvedValue(result());

        const rendered = await launch(60);

        const modelId = 'ddsp-violin:magenta-js-ddsp-2020-01-05';
        expect(rendered.backend).toBe('webgpu');
        expect(withDdspInstrumentLock).toHaveBeenCalledWith('ddsp-violin', 'shared', expect.any(Function));
        expect(checkDdspInstrumentReady).toHaveBeenCalledWith({
            id: 'ddsp-violin',
            version: 'magenta-js-ddsp-2020-01-05',
            artifacts: expect.any(Array),
        });
        expect(inferenceWorkerBridge.loadDdspSession).toHaveBeenCalledWith(
            expect.objectContaining({ modelId }),
            undefined
        );
        expect(inferenceWorkerBridge.runDdspInference).toHaveBeenCalledWith(
            expect.objectContaining({ modelId }),
            undefined
        );
        expect(computeRenderCacheKey).toHaveBeenCalledWith(
            expect.objectContaining({ modelId, qualityParams: 'ddsp-conditioned-v1-250' })
        );
        expect(rendered.audio[500]).toBeCloseTo(0.25, 6);
        expectAdmittedDdspProvenance(rendered);
    });

    it('holds the shared generation lock through readiness, session creation, and inference', async () => {
        const pending = deferred<ReturnType<typeof result>>();
        let insideSharedLock = false;
        withDdspInstrumentLock.mockImplementationOnce(async (_id, mode, operation) => {
            expect(mode).toBe('shared');
            insideSharedLock = true;
            try {
                return await operation();
            } finally {
                insideSharedLock = false;
            }
        });
        checkDdspInstrumentReady.mockImplementationOnce(async () => {
            expect(insideSharedLock).toBe(true);
            return true;
        });
        inferenceWorkerBridge.loadDdspSession.mockImplementationOnce(async () => {
            expect(insideSharedLock).toBe(true);
            return 'webgpu';
        });
        inferenceWorkerBridge.runDdspInference.mockImplementationOnce(async () => {
            expect(insideSharedLock).toBe(true);
            return pending.promise;
        });

        const rendering = launch(60);
        await vi.waitFor(() => expect(inferenceWorkerBridge.runDdspInference).toHaveBeenCalledOnce());
        expect(insideSharedLock).toBe(true);
        pending.resolve(result());
        await rendering;
        expect(insideSharedLock).toBe(false);
    });

    it('refuses a render starting after removal or seeing an unpublished/wrong generation', async () => {
        checkDdspInstrumentReady.mockResolvedValueOnce(false);

        await expect(launch(60)).rejects.toThrow('generation is not ready');

        expect(inferenceWorkerBridge.loadDdspSession).not.toHaveBeenCalled();
        expect(inferenceWorkerBridge.runDdspInference).not.toHaveBeenCalled();
        expect(writeRenderCache).not.toHaveBeenCalled();
    });

    it('confirms the runtime backend before returning cached audio', async () => {
        const cached = new Float32Array([0.1, 0.2]);
        readRenderCache.mockResolvedValueOnce(cached);

        const rendered = await launch(60);

        expect(rendered).toMatchObject({ audio: cached, backend: 'webgpu', sampleRate: 44_100 });
        expectAdmittedDdspProvenance(rendered);
        expect(inferenceWorkerBridge.loadDdspSession).toHaveBeenCalledOnce();
        expect(inferenceWorkerBridge.runDdspInference).not.toHaveBeenCalled();
    });

    it('refuses a render if the runtime backend changes after session creation', async () => {
        inferenceWorkerBridge.runDdspInference.mockResolvedValue({ ...result(), backend: 'wasm' });

        await expect(launch(60)).rejects.toThrow('webgpu -> wasm');

        expect(renderQueueStore.value?.phraseStatusMap['phrase-A']).toBe('error');
    });

    it('keeps the newer request current when the older request completes first', async () => {
        const older = deferred<ReturnType<typeof result>>();
        const newer = deferred<ReturnType<typeof result>>();
        vi.spyOn(crypto, 'randomUUID').mockReturnValueOnce(REQUEST_A).mockReturnValueOnce(REQUEST_B);
        inferenceWorkerBridge.runDdspInference
            .mockImplementationOnce(() => older.promise)
            .mockImplementationOnce(() => newer.promise);

        const olderRender = launch(60);
        await vi.waitFor(() => expect(inferenceWorkerBridge.runDdspInference).toHaveBeenCalledTimes(1));
        const newerRender = launch(62);
        await vi.waitFor(() => expect(inferenceWorkerBridge.runDdspInference).toHaveBeenCalledTimes(2));

        older.resolve(result(0.1));
        await olderRender;

        expect(renderQueueStore.value?.entries).toEqual([
            expect.objectContaining({ phraseId: 'phrase-A', requestId: REQUEST_B }),
        ]);
        expect(renderQueueStore.value?.cachedPhraseIds).toEqual([]);
        expect(renderQueueStore.value?.phraseStatusMap['phrase-A']).toBe('rendering-browser');
        expect(inferenceProgressStore.value?.activeRenders[REQUEST_B]).toBeDefined();

        newer.resolve(result(0.2));
        await newerRender;
        expect(renderQueueStore.value?.entries).toEqual([]);
        expect(renderQueueStore.value?.cachedPhraseIds).toHaveLength(1);
        expect(renderQueueStore.value?.phraseStatusMap['phrase-A']).toBe('preview');
    });

    it('does not let an older completion overwrite a newer request that already completed', async () => {
        const older = deferred<ReturnType<typeof result>>();
        const newer = deferred<ReturnType<typeof result>>();
        vi.spyOn(crypto, 'randomUUID').mockReturnValueOnce(REQUEST_A).mockReturnValueOnce(REQUEST_B);
        inferenceWorkerBridge.runDdspInference
            .mockImplementationOnce(() => older.promise)
            .mockImplementationOnce(() => newer.promise);

        const olderRender = launch(60);
        await vi.waitFor(() => expect(inferenceWorkerBridge.runDdspInference).toHaveBeenCalledTimes(1));
        const newerRender = launch(62);
        await vi.waitFor(() => expect(inferenceWorkerBridge.runDdspInference).toHaveBeenCalledTimes(2));

        newer.resolve(result(0.2));
        await newerRender;
        const completedState = structuredClone(renderQueueStore.value);

        older.resolve(result(0.1));
        await olderRender;

        expect(renderQueueStore.value).toEqual(completedState);
        expect(renderQueueStore.value?.cachedPhraseIds).toHaveLength(1);
        expect(renderQueueStore.value?.phraseStatusMap['phrase-A']).toBe('preview');
    });

    it('ignores an older failure but records the current request failure', async () => {
        const older = deferred<ReturnType<typeof result>>();
        const newer = deferred<ReturnType<typeof result>>();
        vi.spyOn(crypto, 'randomUUID').mockReturnValueOnce(REQUEST_A).mockReturnValueOnce(REQUEST_B);
        inferenceWorkerBridge.runDdspInference
            .mockImplementationOnce(() => older.promise)
            .mockImplementationOnce(() => newer.promise);

        const olderRender = launch(60);
        void olderRender.catch(() => undefined);
        await vi.waitFor(() => expect(inferenceWorkerBridge.runDdspInference).toHaveBeenCalledTimes(1));
        const newerRender = launch(62);
        void newerRender.catch(() => undefined);
        await vi.waitFor(() => expect(inferenceWorkerBridge.runDdspInference).toHaveBeenCalledTimes(2));

        older.reject(new Error('older failed'));
        await expect(olderRender).rejects.toThrow('older failed');
        expect(renderQueueStore.value?.entries).toEqual([
            expect.objectContaining({ requestId: REQUEST_B, status: 'rendering-browser' }),
        ]);
        expect(renderQueueStore.value?.phraseStatusMap['phrase-A']).toBe('rendering-browser');
        expect(inferenceProgressStore.value?.activeRenders[REQUEST_B]).toBeDefined();

        newer.reject(new Error('newer failed'));
        await expect(newerRender).rejects.toThrow('newer failed');
        expect(renderQueueStore.value?.entries[0]).toEqual(
            expect.objectContaining({ requestId: REQUEST_B, status: 'error' })
        );
        expect(renderQueueStore.value?.phraseStatusMap['phrase-A']).toBe('error');
    });

    it('propagates late cancellation without letting the old request remove the newer one', async () => {
        const older = deferred<ReturnType<typeof result>>();
        const newer = deferred<ReturnType<typeof result>>();
        const olderController = new AbortController();
        vi.spyOn(crypto, 'randomUUID').mockReturnValueOnce(REQUEST_A).mockReturnValueOnce(REQUEST_B);
        inferenceWorkerBridge.runDdspInference
            .mockImplementationOnce((_input: unknown, signal: AbortSignal | undefined) => {
                signal?.addEventListener(
                    'abort',
                    () => older.reject(new DOMException('Render cancelled', 'AbortError')),
                    { once: true }
                );
                return older.promise;
            })
            .mockImplementationOnce(() => newer.promise);

        const olderRender = launch(60, olderController.signal);
        void olderRender.catch(() => undefined);
        await vi.waitFor(() => expect(inferenceWorkerBridge.runDdspInference).toHaveBeenCalledTimes(1));
        const newerRender = launch(62);
        await vi.waitFor(() => expect(inferenceWorkerBridge.runDdspInference).toHaveBeenCalledTimes(2));

        olderController.abort();
        await expect(olderRender).rejects.toMatchObject({ name: 'AbortError' });
        expect(inferenceWorkerBridge.loadDdspSession).toHaveBeenNthCalledWith(
            1,
            expect.any(Object),
            olderController.signal
        );
        expect(inferenceWorkerBridge.runDdspInference).toHaveBeenNthCalledWith(
            1,
            expect.objectContaining({ requestId: REQUEST_A }),
            olderController.signal
        );
        expect(renderQueueStore.value?.entries).toEqual([expect.objectContaining({ requestId: REQUEST_B })]);
        expect(inferenceProgressStore.value?.activeRenders[REQUEST_B]).toBeDefined();

        newer.resolve(result(0.2));
        await newerRender;
        expect(renderQueueStore.value?.phraseStatusMap['phrase-A']).toBe('preview');
    });

    it('removes only the current request when that request is cancelled', async () => {
        const pending = deferred<ReturnType<typeof result>>();
        const controller = new AbortController();
        vi.spyOn(crypto, 'randomUUID').mockReturnValueOnce(REQUEST_A);
        inferenceWorkerBridge.runDdspInference.mockImplementationOnce(
            (_input: unknown, signal: AbortSignal | undefined) => {
                signal?.addEventListener(
                    'abort',
                    () => pending.reject(new DOMException('Render cancelled', 'AbortError')),
                    { once: true }
                );
                return pending.promise;
            }
        );

        const renderPromise = launch(60, controller.signal);
        void renderPromise.catch(() => undefined);
        await vi.waitFor(() => expect(inferenceWorkerBridge.runDdspInference).toHaveBeenCalledOnce());
        controller.abort();

        await expect(renderPromise).rejects.toMatchObject({ name: 'AbortError' });
        expect(renderQueueStore.value?.entries).toEqual([]);
        expect(renderQueueStore.value?.phraseStatusMap['phrase-A']).toBe('not-rendered');
        expect(inferenceProgressStore.value?.activeRenders[REQUEST_A]).toBeUndefined();
    });
});
