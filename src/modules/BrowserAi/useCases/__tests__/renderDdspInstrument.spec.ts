import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { injectDependencies } from '#/infra/di/testing/injectDependencies';

import { resolveDdspInstrument } from '../../models/DdspInstrumentCatalog';
import { inferenceWorkerBridge } from '../../repositories/inferenceWorkerBridge';
import { renderRequestCancellation } from '../../repositories/renderRequestCancellation';
import { inferenceProgressStore } from '../../stores/inferenceProgressStore';
import { renderQueueStore } from '../../stores/renderQueueStore';
import { cancelRender } from '../cancelRender';
import { renderDdspInstrument } from '../renderDdspInstrument';

const loadDdspSession = vi.fn();
const runDdspInference = vi.fn();
const cancelTfjsRequest = vi.fn();
const checkDdspInstrumentReady = vi.fn();
const computeRenderCacheKey = vi.fn();
const readRenderCache = vi.fn();
const writeRenderCache = vi.fn();
const withDdspInstrumentLock = vi.fn();
const resampleTo44100 = vi.fn();
const applyFades = vi.fn();
const logger = { info: vi.fn(), warn: vi.fn() };

const SETTINGS = {
    averageMaxLoudness: -48.6,
    loudnessThreshold: -100,
    meanLoudness: -68.5,
    meanPitch: 62,
    modelMaxFrameLength: 1250,
    postGain: 2,
} as const;
const MODEL_CHUNK_SAMPLES = 80_000;

function render(overrides: Partial<Parameters<typeof renderDdspInstrument>[0]> = {}) {
    return renderDdspInstrument({
        phraseId: 'phrase-1',
        instrumentId: 'ddsp-violin',
        notes: [{ pitch: 50, velocity: 100, startSec: 0, durationSec: 0.1 }],
        durationSec: 0.101,
        ...overrides,
    });
}

describe('renderDdspInstrument', () => {
    let lockHeld = false;

    beforeEach(() => {
        lockHeld = false;
        renderQueueStore.set({ entries: [], cachedPhraseIds: [], phraseStatusMap: {}, phraseRequestIds: {} });
        inferenceProgressStore.set({ activeRenders: {} });
        loadDdspSession.mockReset().mockImplementation(() => {
            expect(lockHeld).toBe(true);
            return Promise.resolve({
                sessionKey: 'verified-session',
                backend: 'webgpu',
                modelFrameLength: SETTINGS.modelMaxFrameLength,
                settings: SETTINGS,
            });
        });
        runDdspInference.mockReset().mockImplementation(({ requestId }: { requestId: string }) => {
            expect(lockHeld).toBe(true);
            return Promise.resolve({
                type: 'ddsp-result',
                requestId,
                audio: new Float32Array(MODEL_CHUNK_SAMPLES).fill(0.2),
                nativeSampleRate: 16_000,
                backend: 'webgpu',
            });
        });
        cancelTfjsRequest.mockReset();
        checkDdspInstrumentReady.mockReset().mockImplementation(() => {
            expect(lockHeld).toBe(true);
            return Promise.resolve(true);
        });
        computeRenderCacheKey
            .mockReset()
            .mockImplementation(({ qualityParams }: { qualityParams: string }) =>
                Promise.resolve(`cache:${qualityParams}`)
            );
        readRenderCache.mockReset().mockResolvedValue(null);
        writeRenderCache.mockReset().mockResolvedValue(undefined);
        withDdspInstrumentLock
            .mockReset()
            .mockImplementation(
                async (_id: string, _mode: string, operation: () => Promise<unknown>, signal?: AbortSignal) => {
                    if (signal?.aborted) {
                        throw signal.reason;
                    }
                    lockHeld = true;
                    try {
                        return await operation();
                    } finally {
                        lockHeld = false;
                    }
                }
            );
        resampleTo44100.mockReset().mockImplementation(({ audio }: { audio: Float32Array }) => Promise.resolve(audio));
        applyFades.mockReset();
        logger.info.mockReset();
        logger.warn.mockReset();
        vi.spyOn(inferenceWorkerBridge, 'cancelTfjsRequest').mockImplementation(cancelTfjsRequest);
        injectDependencies(renderDdspInstrument, {
            applyFades,
            checkDdspInstrumentReady,
            computeRenderCacheKey,
            inferenceWorkerBridge: { loadDdspSession, runDdspInference },
            logger,
            readRenderCache,
            renderRequestCancellation,
            resampleTo44100,
            withDdspInstrumentLock,
            writeRenderCache,
        });
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
        'rejects invalid duration %s before side effects',
        async (durationSec) => {
            await expect(render({ durationSec })).rejects.toThrow(/duration/i);
            expect(withDdspInstrumentLock).not.toHaveBeenCalled();
            expect(loadDdspSession).not.toHaveBeenCalled();
        }
    );

    it('rejects a duration that cannot produce one native sample before any side effect', async () => {
        await expect(render({ durationSec: 1 / 44_100 })).rejects.toThrow(/duration/i);

        expect(withDdspInstrumentLock).not.toHaveBeenCalled();
        expect(loadDdspSession).not.toHaveBeenCalled();
        expect(runDdspInference).not.toHaveBeenCalled();
    });

    it('returns the exact non-frame-aligned sample count and distinguishes durations inside one feature frame', async () => {
        const first = await render({ durationSec: 0.101 });
        const second = await render({ phraseId: 'phrase-2', durationSec: 0.102 });

        expect(first.audio).toHaveLength(Math.round(0.101 * 44_100));
        expect(second.audio).toHaveLength(Math.round(0.102 * 44_100));
        const qualities = computeRenderCacheKey.mock.calls.map((call) => call[0].qualityParams);
        expect(qualities[0]).not.toBe(qualities[1]);
        expect(computeRenderCacheKey.mock.calls.every((call) => call[0].modelId === 'verified-session')).toBe(true);
        expect(qualities).toEqual(
            expect.arrayContaining([
                expect.stringContaining(`samples44100=${String(Math.round(0.101 * 44_100))}`),
                expect.stringContaining(`samples44100=${String(Math.round(0.102 * 44_100))}`),
            ])
        );
    });

    it('holds the shared verified-generation lock from readiness through inference', async () => {
        await render();

        expect(withDdspInstrumentLock).toHaveBeenCalledWith(
            'ddsp-violin',
            'shared',
            expect.any(Function),
            expect.any(AbortSignal)
        );
        expect(checkDdspInstrumentReady).toHaveBeenCalledWith({
            id: 'ddsp-violin',
            version: resolveDdspInstrument('ddsp-violin').artifactVersion,
            artifacts: resolveDdspInstrument('ddsp-violin').artifacts,
        });
        expect(runDdspInference).toHaveBeenCalledOnce();
        expect(lockHeld).toBe(false);
    });

    it('rejects a wrong-length cache entry and replaces it with exact audio', async () => {
        readRenderCache.mockResolvedValue(new Float32Array(3));

        const result = await render();

        expect(runDdspInference).toHaveBeenCalledOnce();
        expect(result.audio).toHaveLength(Math.round(0.101 * 44_100));
        expect(writeRenderCache).toHaveBeenCalledOnce();
    });

    it('loads the verified hardware session before accepting an exact cache hit', async () => {
        const cached = new Float32Array(Math.round(0.101 * 44_100)).fill(0.1);
        readRenderCache.mockResolvedValue(cached);

        const result = await render();

        expect(loadDdspSession).toHaveBeenCalledOnce();
        expect(result.audio).toBe(cached);
        expect(runDdspInference).not.toHaveBeenCalled();
    });

    it('cancels only its active TFJS request and leaves no stale queue owner', async () => {
        runDdspInference.mockImplementation(({ requestId }: { requestId: string }) => {
            expect(lockHeld).toBe(true);
            return new Promise((_resolve, reject) => {
                cancelTfjsRequest.mockImplementationOnce(() =>
                    reject(new DOMException('Render cancelled', 'AbortError'))
                );
                expect(requestId).toBe(renderQueueStore.value?.entries[0]?.requestId);
            });
        });

        const pending = render();
        await vi.waitFor(() => expect(runDdspInference).toHaveBeenCalledOnce());
        const requestId = renderQueueStore.value?.entries[0]?.requestId;
        expect(requestId).toBeDefined();
        cancelRender({ phraseId: 'phrase-1', requestId: requestId! });

        await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
        expect(cancelTfjsRequest).toHaveBeenCalledWith(requestId);
        expect(renderQueueStore.value?.entries).toEqual([]);
        expect(inferenceProgressStore.value?.activeRenders).toEqual({});
    });

    it('aborts a deferred DDSP session load through request-owned cancellation', async () => {
        let rejectLoad = (_error: unknown): void => undefined;
        let loadSignal: AbortSignal | undefined;
        loadDdspSession.mockImplementation(
            (_input, signal?: AbortSignal) =>
                new Promise((_resolve, reject) => {
                    rejectLoad = reject;
                    loadSignal = signal;
                    signal?.addEventListener(
                        'abort',
                        () => reject(new DOMException('Render cancelled', 'AbortError')),
                        { once: true }
                    );
                })
        );

        const pending = render();
        await vi.waitFor(() => expect(loadDdspSession).toHaveBeenCalledOnce());
        const requestId = renderQueueStore.value?.entries[0]?.requestId;
        expect(requestId).toBeDefined();
        const observedRequestId = loadDdspSession.mock.calls[0]?.[0].requestId;
        cancelRender({ phraseId: 'phrase-1', requestId: requestId! });
        const cancelledBeforeWorkerReply = loadSignal?.aborted === true;
        if (!cancelledBeforeWorkerReply) {
            rejectLoad(new DOMException('Red proof cleanup', 'AbortError'));
        }

        await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
        expect(cancelledBeforeWorkerReply).toBe(true);
        expect(observedRequestId).toBe(requestId);
        expect(cancelTfjsRequest).toHaveBeenCalledWith(requestId);
        expect(runDdspInference).not.toHaveBeenCalled();
        expect(renderRequestCancellation.cancel(requestId!)).toBe(false);
    });

    it('aborts while queued for the shared lock and leaves a sibling render usable', async () => {
        let queuedSignal: AbortSignal | undefined;
        let rejectQueued = (_error: unknown): void => undefined;
        withDdspInstrumentLock.mockImplementationOnce(
            (_id: string, _mode: string, _operation: () => Promise<unknown>, signal?: AbortSignal) =>
                new Promise((_resolve, reject) => {
                    queuedSignal = signal;
                    rejectQueued = reject;
                    signal?.addEventListener('abort', () => reject(signal.reason), { once: true });
                })
        );

        const cancelled = render();
        await vi.waitFor(() => expect(withDdspInstrumentLock).toHaveBeenCalledOnce());
        const requestId = renderQueueStore.value?.entries[0]?.requestId;
        expect(requestId).toBeDefined();
        cancelRender({ phraseId: 'phrase-1', requestId: requestId! });
        const cancelledWhileQueued = queuedSignal?.aborted === true;
        if (!cancelledWhileQueued) {
            rejectQueued(new DOMException('Red proof cleanup', 'AbortError'));
        }

        await expect(cancelled).rejects.toMatchObject({ name: 'AbortError' });
        expect(cancelledWhileQueued).toBe(true);
        expect(checkDdspInstrumentReady).not.toHaveBeenCalled();
        expect(loadDdspSession).not.toHaveBeenCalled();
        expect(runDdspInference).not.toHaveBeenCalled();
        expect(renderRequestCancellation.cancel(requestId!)).toBe(false);

        const sibling = await render({ phraseId: 'phrase-2' });
        expect(sibling.backend).toBe('webgpu');
        expect(runDdspInference).toHaveBeenCalledOnce();
    });

    it('honors AbortSignal ownership and passes the same signal through session load and inference', async () => {
        const controller = new AbortController();

        await render({ signal: controller.signal });

        const requestSignal = withDdspInstrumentLock.mock.calls[0]?.[3];
        expect(requestSignal).toBeInstanceOf(AbortSignal);
        expect(requestSignal).not.toBe(controller.signal);
        expect(loadDdspSession.mock.calls[0]?.[1]).toBe(requestSignal);
        expect(runDdspInference.mock.calls[0]?.[1]).toBe(requestSignal);

        controller.abort();
        expect(requestSignal?.aborted).toBe(false);
        await expect(render({ phraseId: 'aborted', signal: controller.signal })).rejects.toMatchObject({
            name: 'AbortError',
        });
        expect(renderQueueStore.value?.phraseStatusMap.aborted).toBe('not-rendered');
    });
});
