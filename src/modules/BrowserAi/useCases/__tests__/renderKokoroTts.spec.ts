import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── Hoisted mocks for module-level collaborators ────────────────────────────
const loadOnnxSession = vi.hoisted(() =>
    vi.fn<(input: { modelId: string; modelData: ArrayBuffer }) => Promise<void>>()
);
const runKokoroTts = vi.hoisted(() =>
    vi.fn<
        (input: { requestId: string; inputIds: bigint[]; style: Float32Array; speed: number }) => Promise<{
            type: 'tts-result';
            requestId: string;
            audio: Float32Array;
            samplingRate: number;
        }>
    >()
);
const readModel = vi.hoisted(() => vi.fn<() => Promise<ArrayBuffer | null>>());
const readRenderCache = vi.hoisted(() => vi.fn<() => Promise<Float32Array | null>>());
const writeRenderCache = vi.hoisted(() => vi.fn<() => Promise<void>>());
const computeRenderCacheKey = vi.hoisted(() => vi.fn<() => Promise<string>>());
const textToKokoroInputIds = vi.hoisted(() => vi.fn());
const resampleTo44100 = vi.hoisted(() =>
    vi.fn<(input: { audio: Float32Array; fromSampleRate: number }) => Promise<Float32Array>>()
);
const applyFades = vi.hoisted(() => vi.fn());

vi.mock('../../repositories/inferenceWorkerBridge', () => ({
    inferenceWorkerBridge: { loadOnnxSession, runKokoroTts },
}));

vi.mock('../../repositories/computeRenderCacheKey', () => ({ computeRenderCacheKey }));
vi.mock('../../repositories/readModel', () => ({ readModel }));
vi.mock('../../repositories/readRenderCache', () => ({ readRenderCache }));
vi.mock('../../repositories/writeRenderCache', () => ({ writeRenderCache }));
vi.mock('../../services/kokoroTokenizer', () => ({ textToKokoroInputIds }));
vi.mock('../../services/audioResampler', () => ({ resampleTo44100, applyFades }));

import { inferenceProgressStore } from '../../stores/inferenceProgressStore';
import { renderQueueStore } from '../../stores/renderQueueStore';
import { renderKokoroTts } from '../renderKokoroTts';

function voice_embedding_buffer(entryCount: number): ArrayBuffer {
    return new Float32Array(256 * entryCount).buffer;
}

function stub_fetch_ok(buffer: ArrayBuffer): void {
    vi.stubGlobal(
        'fetch',
        vi.fn(() =>
            Promise.resolve({
                ok: true,
                statusText: 'OK',
                arrayBuffer: (): Promise<ArrayBuffer> => Promise.resolve(buffer),
            } as unknown as Response)
        )
    );
}

function callRender(
    overrides: Partial<Parameters<typeof renderKokoroTts>[0]> = {}
): ReturnType<typeof renderKokoroTts> {
    return renderKokoroTts({
        phraseId: 'phrase-1',
        text: 'hello there',
        speakerId: 'af_heart_default',
        ...overrides,
    });
}

describe('renderKokoroTts', () => {
    beforeEach(() => {
        loadOnnxSession.mockReset().mockResolvedValue(undefined);
        runKokoroTts.mockReset().mockResolvedValue({
            type: 'tts-result',
            requestId: 'req-1',
            audio: new Float32Array(2400),
            samplingRate: 24000,
        });
        readModel.mockReset().mockResolvedValue(new ArrayBuffer(8));
        readRenderCache.mockReset().mockResolvedValue(null);
        writeRenderCache.mockReset().mockResolvedValue(undefined);
        computeRenderCacheKey.mockReset().mockResolvedValue('cache-key-1');
        textToKokoroInputIds.mockReset().mockReturnValue({ inputIds: [1n, 2n, 3n], tokenCount: 3, warnings: [] });
        resampleTo44100.mockReset().mockImplementation(({ audio }: { audio: Float32Array }) => Promise.resolve(audio));
        applyFades.mockReset();
        renderQueueStore.set({ entries: [], cachedPhraseIds: [], phraseStatusMap: {} });
        inferenceProgressStore.set({ activeRenders: {} });
        stub_fetch_ok(voice_embedding_buffer(4));
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('should return the cached render without touching the inference worker', async () => {
        const cached = new Float32Array([0.1, 0.2, 0.3]);
        readRenderCache.mockResolvedValue(cached);

        const result = await callRender();

        expect(result.audio).toBe(cached);
        expect(result.sampleRate).toBe(44100);
        expect(result.provenance).toMatchObject({
            modelId: 'kokoro-82m-q8',
            voiceId: 'af_heart_default',
            renderQuality: 'standard',
            tier: 'browser-preview',
        });
        expect(loadOnnxSession).not.toHaveBeenCalled();
        expect(runKokoroTts).not.toHaveBeenCalled();
        expect(renderQueueStore.value?.phraseStatusMap['phrase-1']).toBe('preview');
    });

    it('should throw a re-download message when the Kokoro model is absent from OPFS', async () => {
        readModel.mockResolvedValue(null);

        await expect(callRender()).rejects.toThrow(/not found in OPFS — download it in AI Settings/);

        expect(renderQueueStore.value?.phraseStatusMap['phrase-1']).toBe('error');
        expect(Object.keys(inferenceProgressStore.value?.activeRenders ?? {})).toHaveLength(0);
    });

    it('should throw when Kokoro inference produces no audio', async () => {
        runKokoroTts.mockResolvedValue({
            type: 'tts-result',
            requestId: 'req-1',
            audio: new Float32Array(0),
            samplingRate: 24000,
        });

        await expect(callRender()).rejects.toThrow(/produced no audio/);

        expect(renderQueueStore.value?.phraseStatusMap['phrase-1']).toBe('error');
    });

    it('should run the full render pipeline and cache the result on a cache miss', async () => {
        const result = await callRender({ speakerId: 'af_heart_full', speed: 1.5 });

        expect(loadOnnxSession).toHaveBeenCalledWith({ modelId: 'kokoro-82m-q8', modelData: expect.any(ArrayBuffer) });
        expect(runKokoroTts).toHaveBeenCalledWith(expect.objectContaining({ inputIds: [1n, 2n, 3n], speed: 1.5 }));
        expect(applyFades).toHaveBeenCalledWith(expect.any(Float32Array), 441);
        expect(writeRenderCache).toHaveBeenCalledWith({ cacheKey: 'cache-key-1', audio: expect.any(Float32Array) });
        expect(result.sampleRate).toBe(44100);
        expect(result.provenance.voiceId).toBe('af_heart_full');
        expect(renderQueueStore.value?.phraseStatusMap['phrase-1']).toBe('preview');
        expect(renderQueueStore.value?.cachedPhraseIds).toContain('cache-key-1');
        expect(Object.keys(inferenceProgressStore.value?.activeRenders ?? {})).toHaveLength(0);
    });

    it('should time-stretch the output when the target duration differs from the rendered duration', async () => {
        // Force the post-resample length to a clean 1 second at 44.1kHz so the
        // stretch ratio below is exact and not dependent on the identity mock's
        // pass-through of the pre-resample sample count.
        resampleTo44100.mockResolvedValueOnce(new Float32Array(44100));

        await callRender({ speakerId: 'af_heart_stretch', targetDurationSec: 2 });

        // One resample 24k→44.1k, plus one stretch resample — ratio 0.5 is far outside the 0.01 tolerance.
        expect(resampleTo44100).toHaveBeenCalledTimes(2);
        const secondCall = resampleTo44100.mock.calls[1]?.[0];
        expect(secondCall?.fromSampleRate).toBe(Math.round(44100 * 0.5));
    });

    it('should skip time-stretching when the requested duration already matches', async () => {
        runKokoroTts.mockResolvedValue({
            type: 'tts-result',
            requestId: 'req-1',
            audio: new Float32Array(44100),
            samplingRate: 24000,
        });

        await callRender({ speakerId: 'af_heart_notretch', targetDurationSec: 1 });

        expect(resampleTo44100).toHaveBeenCalledTimes(1);
    });

    it('should throw when the voice embedding CDN fetch fails', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(() => Promise.resolve({ ok: false, statusText: 'Not Found' } as unknown as Response))
        );

        await expect(callRender({ speakerId: 'af_heart_fetchfail' })).rejects.toThrow(
            /Failed to fetch Kokoro voice embedding for "af_heart_fetchfail": Not Found/
        );
    });

    it('should throw when the fetched voice embedding file is empty or corrupted', async () => {
        stub_fetch_ok(new Float32Array(10).buffer);

        await expect(callRender({ speakerId: 'af_heart_corrupt' })).rejects.toThrow(/empty or corrupted/);
    });
});
