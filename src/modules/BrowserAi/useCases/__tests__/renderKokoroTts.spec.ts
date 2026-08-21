import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── Hoisted mocks for module-level collaborators ────────────────────────────
const loadOnnxSession = vi.hoisted(() =>
    vi.fn<(input: { modelId: string; modelDataPort: MessagePort }) => Promise<void>>()
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
const readVerifiedModel = vi.hoisted(() => vi.fn<() => Promise<MessagePort | null>>());
type ReadRenderCacheInput = Parameters<typeof import('../../repositories/readRenderCache').readRenderCache>[0];
const readRenderCache = vi.hoisted(() => vi.fn<(input: ReadRenderCacheInput) => Promise<Float32Array | null>>());
const writeRenderCache = vi.hoisted(() => vi.fn<() => Promise<void>>());
type ComputeRenderCacheKeyCall = Parameters<
    typeof import('../../repositories/computeRenderCacheKey').computeRenderCacheKey
>[0];
const computeRenderCacheKey = vi.hoisted(() => vi.fn<(input: ComputeRenderCacheKeyCall) => Promise<string>>());
const textToKokoroInputIds = vi.hoisted(() => vi.fn());
const resampleTo44100 = vi.hoisted(() =>
    vi.fn<(input: { audio: Float32Array; fromSampleRate: number }) => Promise<Float32Array>>()
);
const applyFades = vi.hoisted(() => vi.fn());
const sha256ArrayBuffer = vi.hoisted(() => vi.fn<() => Promise<string>>());
const releaseGate = vi.hoisted(() => ({ kokoro: true }));

type Deferred<TValue> = {
    promise: Promise<TValue>;
    resolve: (value: TValue) => void;
};

function deferred<TValue>(): Deferred<TValue> {
    let resolveDeferred: (value: TValue) => void = () => undefined;
    const promise = new Promise<TValue>((resolve) => {
        resolveDeferred = resolve;
    });
    return { promise, resolve: resolveDeferred };
}

vi.mock('#/infra/release/modelReleaseAdmission', () => ({ MODEL_RELEASE_ADMISSION: releaseGate }));

vi.mock('../../repositories/inferenceWorkerBridge', () => ({
    inferenceWorkerBridge: { loadOnnxSession, runKokoroTts },
}));

vi.mock('../../repositories/computeRenderCacheKey', () => ({ computeRenderCacheKey }));
vi.mock('../../repositories/readVerifiedModel', () => ({ readVerifiedModel }));
vi.mock('../../repositories/readRenderCache', () => ({ readRenderCache }));
vi.mock('../../repositories/writeRenderCache', () => ({ writeRenderCache }));
vi.mock('../../repositories/sha256ArrayBuffer', () => ({ sha256ArrayBuffer }));
vi.mock('../../services/kokoroTokenizer', () => ({ textToKokoroInputIds }));
vi.mock('../../services/audioResampler', () => ({ resampleTo44100, applyFades }));

import { KOKORO_MODEL_ARTIFACT, KOKORO_VOICE_ARTIFACTS } from '../../models/KokoroArtifactManifest';
import { inferenceProgressStore } from '../../stores/inferenceProgressStore';
import { renderQueueStore } from '../../stores/renderQueueStore';
import { renderKokoroTts } from '../renderKokoroTts';

function voice_embedding_buffer(): ArrayBuffer {
    return new ArrayBuffer(522_240);
}

function voice_hash(id: (typeof KOKORO_VOICE_ARTIFACTS)[number]['id']): string {
    return KOKORO_VOICE_ARTIFACTS.find((voice) => voice.id === id)!.sha256;
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
        speakerId: 'af_heart',
        ...overrides,
    });
}

describe('renderKokoroTts', () => {
    let modelDataPort: MessagePort;

    beforeEach(() => {
        loadOnnxSession.mockReset().mockResolvedValue(undefined);
        runKokoroTts.mockReset().mockResolvedValue({
            type: 'tts-result',
            requestId: 'req-1',
            audio: new Float32Array(2400),
            samplingRate: 24000,
        });
        modelDataPort = new MessageChannel().port1;
        readVerifiedModel.mockReset().mockResolvedValue(modelDataPort);
        readRenderCache.mockReset().mockResolvedValue(null);
        writeRenderCache.mockReset().mockResolvedValue(undefined);
        computeRenderCacheKey.mockReset().mockResolvedValue('cache-key-1');
        textToKokoroInputIds.mockReset().mockReturnValue({ inputIds: [1n, 2n, 3n], tokenCount: 3, warnings: [] });
        resampleTo44100.mockReset().mockImplementation(({ audio }: { audio: Float32Array }) => Promise.resolve(audio));
        applyFades.mockReset();
        sha256ArrayBuffer.mockReset().mockResolvedValue(voice_hash('af_heart'));
        releaseGate.kokoro = true;
        renderQueueStore.set({ entries: [], cachedPhraseIds: [], phraseStatusMap: {} });
        inferenceProgressStore.set({ activeRenders: {} });
        stub_fetch_ok(voice_embedding_buffer());
    });

    it('rejects rendering while Kokoro artifacts are withheld', async () => {
        releaseGate.kokoro = false;

        await expect(callRender()).rejects.toThrow(/not admitted in this release/);
        expect(readVerifiedModel).not.toHaveBeenCalled();
        expect(fetch).not.toHaveBeenCalled();
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
            modelId: KOKORO_MODEL_ARTIFACT.id,
            voiceId: 'af_heart',
            renderQuality: 'standard',
            tier: 'browser-preview',
        });
        expect(loadOnnxSession).not.toHaveBeenCalled();
        expect(runKokoroTts).not.toHaveBeenCalled();
        expect(renderQueueStore.value?.phraseStatusMap['phrase-1']).toBe('preview');
    });

    it('does not let an older delayed cache hit reclaim a phrase from a newer render', async () => {
        const oldCache = deferred<Float32Array | null>();
        const newerInference = deferred<{
            type: 'tts-result';
            requestId: string;
            audio: Float32Array;
            samplingRate: number;
        }>();
        const cached = new Float32Array([0.25, 0.5]);
        computeRenderCacheKey.mockResolvedValueOnce('old-cache-key').mockResolvedValueOnce('new-cache-key');
        readRenderCache.mockImplementation(({ cacheKey }) =>
            cacheKey === 'old-cache-key' ? oldCache.promise : Promise.resolve(null)
        );
        runKokoroTts.mockReturnValueOnce(newerInference.promise);

        const oldRender = callRender({ text: 'old request' });
        await vi.waitFor(() => expect(readRenderCache).toHaveBeenCalledWith({ cacheKey: 'old-cache-key' }));

        const newerRender = callRender({ text: 'new request' });
        await vi.waitFor(() => expect(runKokoroTts).toHaveBeenCalledOnce());
        const newerOwner = renderQueueStore.value?.entries[0];
        expect(newerOwner).toMatchObject({ phraseId: 'phrase-1', pipeline: 'kokoro', status: 'rendering-browser' });

        oldCache.resolve(cached);
        await expect(oldRender).resolves.toMatchObject({ audio: cached, sampleRate: 44100 });

        expect(renderQueueStore.value?.entries).toEqual([newerOwner]);
        expect(renderQueueStore.value?.phraseStatusMap['phrase-1']).toBe('rendering-browser');
        expect(renderQueueStore.value?.cachedPhraseIds).not.toContain('old-cache-key');

        newerInference.resolve({
            type: 'tts-result',
            requestId: newerOwner!.requestId,
            audio: new Float32Array(2400),
            samplingRate: 24000,
        });
        await newerRender;

        expect(renderQueueStore.value?.entries).toEqual([]);
        expect(renderQueueStore.value?.phraseStatusMap['phrase-1']).toBe('preview');
        expect(renderQueueStore.value?.cachedPhraseIds).toContain('new-cache-key');
    });

    it('should throw a re-download message when the Kokoro model is absent or invalid', async () => {
        readVerifiedModel.mockResolvedValue(null);

        await expect(callRender()).rejects.toThrow(/absent or failed verification/);

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
        sha256ArrayBuffer.mockResolvedValue(voice_hash('af_nicole'));
        const result = await callRender({ speakerId: 'af_nicole', speed: 1.5 });

        expect(loadOnnxSession).toHaveBeenCalledOnce();
        expect(loadOnnxSession.mock.calls[0]?.[0]?.modelId).toBe(KOKORO_MODEL_ARTIFACT.id);
        expect(loadOnnxSession.mock.calls[0]?.[0]?.modelDataPort).toBe(modelDataPort);
        expect(fetch).toHaveBeenCalledWith(
            expect.stringContaining('/resolve/1939ad2a8e416c0acfeecc08a694d14ef25f2231/voices/af_nicole.bin'),
            { cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer' }
        );
        expect(runKokoroTts).toHaveBeenCalledWith(expect.objectContaining({ inputIds: [1n, 2n, 3n], speed: 1.5 }));
        expect(applyFades).toHaveBeenCalledWith(expect.any(Float32Array), 441);
        expect(writeRenderCache).toHaveBeenCalledWith({ cacheKey: 'cache-key-1', audio: expect.any(Float32Array) });
        expect(result.sampleRate).toBe(44100);
        expect(result.provenance.voiceId).toBe('af_nicole');
        expect(renderQueueStore.value?.phraseStatusMap['phrase-1']).toBe('preview');
        expect(renderQueueStore.value?.cachedPhraseIds).toContain('cache-key-1');
        expect(Object.keys(inferenceProgressStore.value?.activeRenders ?? {})).toHaveLength(0);
    });

    it('should time-stretch the output when the target duration differs from the rendered duration', async () => {
        // Force the post-resample length to a clean 1 second at 44.1kHz so the
        // stretch ratio below is exact and not dependent on the identity mock's
        // pass-through of the pre-resample sample count.
        resampleTo44100.mockResolvedValueOnce(new Float32Array(44100));

        sha256ArrayBuffer.mockResolvedValue(voice_hash('af_sky'));
        await callRender({ speakerId: 'af_sky', targetDurationSec: 2 });

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

        sha256ArrayBuffer.mockResolvedValue(voice_hash('am_adam'));
        await callRender({ speakerId: 'am_adam', targetDurationSec: 1 });

        expect(resampleTo44100).toHaveBeenCalledTimes(1);
    });

    it('should throw when the voice embedding CDN fetch fails', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(() => Promise.resolve({ ok: false, statusText: 'Not Found' } as unknown as Response))
        );

        await expect(callRender({ speakerId: 'am_michael' })).rejects.toThrow(
            /Failed to fetch Kokoro voice embedding for "am_michael": Not Found/
        );
    });

    it('should reject an unknown voice before reading or fetching artifacts', async () => {
        await expect(callRender({ speakerId: 'not-a-voice' })).rejects.toThrow(/Unknown Kokoro voice/);

        expect(readVerifiedModel).not.toHaveBeenCalled();
        expect(fetch).not.toHaveBeenCalled();
    });

    it('should reject a voice embedding with the wrong byte length', async () => {
        stub_fetch_ok(new ArrayBuffer(40));

        await expect(callRender({ speakerId: 'bf_emma' })).rejects.toThrow(/has 40 bytes; expected 522240/);
        expect(sha256ArrayBuffer).not.toHaveBeenCalled();
    });

    it('should reject a voice embedding with the wrong digest', async () => {
        sha256ArrayBuffer.mockResolvedValue('0'.repeat(64));

        await expect(callRender({ speakerId: 'bf_isabella' })).rejects.toThrow(/failed SHA-256 verification/);
    });

    it('should include targetDurationSec in the cache key calculation', async () => {
        const textDecoder = new TextDecoder();
        await callRender({ speakerId: 'af_heart', targetDurationSec: 3.5 });

        expect(computeRenderCacheKey).toHaveBeenCalledTimes(1);
        const firstCall = computeRenderCacheKey.mock.calls[0]?.[0];
        expect(firstCall).toBeDefined();
        const decodedInput = textDecoder.decode(firstCall!.inputData);
        expect(decodedInput).toContain('3.5');
    });
});
