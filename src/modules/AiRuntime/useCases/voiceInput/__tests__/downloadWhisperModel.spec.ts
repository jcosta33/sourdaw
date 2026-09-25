import { webcrypto } from 'node:crypto';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { voiceInputAvailabilityStore } from '../../../stores/voiceInputAvailabilityStore';
import { voiceModelSetupStore, type VoiceModelSetupStatus } from '../../../stores/voiceModelSetupStore';
import { downloadWhisperModel } from '../downloadWhisperModel';

const mocks = vi.hoisted(() => ({
    storeVerifiedWhisperModel: vi.fn<(bytes: Uint8Array) => Promise<void>>(),
    loadCachedWhisperModel: vi.fn<() => Promise<void>>(),
}));

vi.mock('../../../repositories/voiceNativeAdapter/storeVerifiedWhisperModel', () => ({
    storeVerifiedWhisperModel: mocks.storeVerifiedWhisperModel,
}));

vi.mock('../../voiceDictation/loadCachedWhisperModel', () => ({
    loadCachedWhisperModel: mocks.loadCachedWhisperModel,
}));

// A tiny fixture artifact standing in for the pinned 148 MB model: 'abc' has
// a well-known SHA-256, so the use case's verification can run for real.
vi.mock('../../../repositories/voiceInput/whisperModelArtifact', () => ({
    WHISPER_MODEL_ARTIFACT: {
        url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/5359861c739e955e79d9a303bcbc70fb988958b1/ggml-base.en.bin',
        sizeBytes: 3,
        sha256: 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    },
}));

function streamingResponse(chunks: Uint8Array[]): Response {
    let index = 0;
    return {
        ok: true,
        status: 200,
        body: {
            getReader() {
                return {
                    read(): Promise<{ done: boolean; value?: Uint8Array }> {
                        if (index < chunks.length) {
                            const value = chunks[index];
                            index += 1;
                            return Promise.resolve({ done: false, value });
                        }
                        return Promise.resolve({ done: true });
                    },
                };
            },
        },
    } as unknown as Response;
}

function httpFailure(status: number): Response {
    return { ok: false, status } as unknown as Response;
}

function collectSetupStates(): { states: VoiceModelSetupStatus[]; stop: () => void } {
    const states: VoiceModelSetupStatus[] = [];
    const stop = voiceModelSetupStore.subscribe((value) => {
        if (value !== null) {
            states.push(value);
        }
    });
    return { states, stop };
}

describe('downloadWhisperModel', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        if (!globalThis.crypto?.subtle) {
            vi.stubGlobal('crypto', webcrypto);
        }
        voiceModelSetupStore.set({ state: 'missing' });
        voiceInputAvailabilityStore.set({ hasVerifiedLocalModel: false });
        mocks.storeVerifiedWhisperModel.mockResolvedValue(undefined);
        mocks.loadCachedWhisperModel.mockResolvedValue(undefined);
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it.each([{}, { downloadConsent: false }])(
        'throws without fetching when consent is absent (%o)',
        async (options) => {
            const fetchSpy = vi.fn();
            vi.stubGlobal('fetch', fetchSpy);

            await expect(downloadWhisperModel(options)).rejects.toThrow(/Explicit model-download consent/);

            expect(fetchSpy).not.toHaveBeenCalled();
            expect(voiceModelSetupStore.value).toEqual({ state: 'missing' });
            expect(mocks.storeVerifiedWhisperModel).not.toHaveBeenCalled();
        }
    );

    it('downloads with progress, verifies, stores natively, then marks voice ready', async () => {
        const fetchSpy = vi.fn(() =>
            Promise.resolve(streamingResponse([new Uint8Array([97, 98]), new Uint8Array([99])]))
        );
        vi.stubGlobal('fetch', fetchSpy);
        const onProgress = vi.fn();
        const { states, stop } = collectSetupStates();

        await downloadWhisperModel({ downloadConsent: true, onProgress });
        stop();

        expect(fetchSpy).toHaveBeenCalledWith(
            'https://huggingface.co/ggerganov/whisper.cpp/resolve/5359861c739e955e79d9a303bcbc70fb988958b1/ggml-base.en.bin',
            expect.objectContaining({ cache: 'no-store', credentials: 'omit' })
        );
        expect(mocks.storeVerifiedWhisperModel).toHaveBeenCalledWith(new Uint8Array([97, 98, 99]));
        expect(mocks.loadCachedWhisperModel).toHaveBeenCalledOnce();
        expect(voiceModelSetupStore.value).toEqual({ state: 'ready' });
        expect(voiceInputAvailabilityStore.value).toEqual({ hasVerifiedLocalModel: true });
        expect(states[0]).toEqual({ state: 'downloading', progress: 0 });
        expect(states[states.length - 1]).toEqual({ state: 'ready' });
        expect(onProgress).toHaveBeenLastCalledWith(1);
    });

    it('refuses a digest mismatch and never touches the native store', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(() => Promise.resolve(streamingResponse([new Uint8Array([120, 121, 122])])))
        );

        await downloadWhisperModel({ downloadConsent: true });

        expect(mocks.storeVerifiedWhisperModel).not.toHaveBeenCalled();
        expect(mocks.loadCachedWhisperModel).not.toHaveBeenCalled();
        expect(voiceModelSetupStore.value?.state).toBe('error');
        expect(voiceModelSetupStore.value).toMatchObject({ message: expect.stringMatching(/digest mismatch/) });
        expect(voiceInputAvailabilityStore.value).toEqual({ hasVerifiedLocalModel: false });
    });

    it('refuses a size mismatch and never touches the native store', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(() => Promise.resolve(streamingResponse([new Uint8Array([97, 98, 99, 100])])))
        );

        await downloadWhisperModel({ downloadConsent: true });

        expect(mocks.storeVerifiedWhisperModel).not.toHaveBeenCalled();
        expect(voiceModelSetupStore.value).toMatchObject({
            state: 'error',
            message: expect.stringMatching(/size mismatch/),
        });
    });

    it('surfaces an HTTP failure as a retryable error', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(() => Promise.resolve(httpFailure(503)))
        );

        await downloadWhisperModel({ downloadConsent: true });

        expect(voiceModelSetupStore.value).toMatchObject({
            state: 'error',
            message: expect.stringMatching(/HTTP 503/),
        });
        expect(mocks.storeVerifiedWhisperModel).not.toHaveBeenCalled();
    });

    it('leaves a retryable interrupted state on abort and never stores', async () => {
        const controller = new AbortController();
        controller.abort();
        vi.stubGlobal(
            'fetch',
            vi.fn(() => Promise.reject(new DOMException('The operation was aborted.', 'AbortError')))
        );

        await downloadWhisperModel({ downloadConsent: true, signal: controller.signal });

        expect(voiceModelSetupStore.value).toMatchObject({
            state: 'error',
            message: expect.stringMatching(/interrupted/),
        });
        expect(mocks.storeVerifiedWhisperModel).not.toHaveBeenCalled();
        expect(voiceInputAvailabilityStore.value).toEqual({ hasVerifiedLocalModel: false });
    });

    it('reports a native refusal as a retryable error', async () => {
        vi.stubGlobal(
            'fetch',
            vi.fn(() => Promise.resolve(streamingResponse([new Uint8Array([97, 98, 99])])))
        );
        mocks.storeVerifiedWhisperModel.mockRejectedValue(new Error('SHA-256 does not match the pinned digest.'));

        await downloadWhisperModel({ downloadConsent: true });

        expect(voiceModelSetupStore.value).toMatchObject({
            state: 'error',
            message: expect.stringMatching(/pinned digest/),
        });
        expect(voiceInputAvailabilityStore.value).toEqual({ hasVerifiedLocalModel: false });
    });
});
