import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const loadDdspSession = vi.hoisted(() => vi.fn());
const runDdspInference = vi.hoisted(() => vi.fn());
const cancelTfjsRequest = vi.hoisted(() => vi.fn());
const checkDdspInstrumentReady = vi.hoisted(() => vi.fn());
const computeRenderCacheKey = vi.hoisted(() => vi.fn());
const readRenderCache = vi.hoisted(() => vi.fn());
const writeRenderCache = vi.hoisted(() => vi.fn());
const withDdspInstrumentLock = vi.hoisted(() => vi.fn());
const resampleTo44100 = vi.hoisted(() => vi.fn());
const applyFades = vi.hoisted(() => vi.fn());

vi.mock('../../repositories/inferenceWorkerBridge', () => ({
    inferenceWorkerBridge: { cancelTfjsRequest, loadDdspSession, runDdspInference },
}));
vi.mock('../../repositories/checkDdspInstrumentReady', () => ({ checkDdspInstrumentReady }));
vi.mock('../../repositories/computeRenderCacheKey', () => ({ computeRenderCacheKey }));
vi.mock('../../repositories/readRenderCache', () => ({ readRenderCache }));
vi.mock('../../repositories/writeRenderCache', () => ({ writeRenderCache }));
vi.mock('../../repositories/withDdspInstrumentLock', () => ({ withDdspInstrumentLock }));
vi.mock('../../services/audioResampler', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../services/audioResampler')>()),
    applyFades,
    resampleTo44100,
}));

import { resolveDdspInstrument } from '../../models/DdspInstrumentCatalog';
import { inferenceProgressStore } from '../../stores/inferenceProgressStore';
import { renderQueueStore } from '../../stores/renderQueueStore';
import { cancelRender } from '../cancelRender';
import { renderDdspInstrument } from '../renderDdspInstrument';

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
        loadDdspSession.mockReset().mockResolvedValue({
            sessionKey: 'verified-session',
            backend: 'webgpu',
            modelFrameLength: SETTINGS.modelMaxFrameLength,
            settings: SETTINGS,
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
        checkDdspInstrumentReady.mockReset().mockResolvedValue(true);
        computeRenderCacheKey
            .mockReset()
            .mockImplementation(({ qualityParams }: { qualityParams: string }) =>
                Promise.resolve(`cache:${qualityParams}`)
            );
        readRenderCache.mockReset().mockResolvedValue(null);
        writeRenderCache.mockReset().mockResolvedValue(undefined);
        withDdspInstrumentLock
            .mockReset()
            .mockImplementation(async (_id: string, _mode: string, operation: () => Promise<unknown>) => {
                lockHeld = true;
                try {
                    return await operation();
                } finally {
                    lockHeld = false;
                }
            });
        resampleTo44100.mockReset().mockImplementation(({ audio }: { audio: Float32Array }) => Promise.resolve(audio));
        applyFades.mockReset();
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

        expect(withDdspInstrumentLock).toHaveBeenCalledWith('ddsp-violin', 'shared', expect.any(Function));
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

    it('honors AbortSignal ownership and passes the same signal through session load and inference', async () => {
        const controller = new AbortController();

        await render({ signal: controller.signal });

        expect(loadDdspSession.mock.calls[0]?.[1]).toBe(controller.signal);
        expect(runDdspInference.mock.calls[0]?.[1]).toBe(controller.signal);

        controller.abort();
        await expect(render({ phraseId: 'aborted', signal: controller.signal })).rejects.toMatchObject({
            name: 'AbortError',
        });
        expect(renderQueueStore.value?.phraseStatusMap.aborted).toBe('not-rendered');
    });
});
