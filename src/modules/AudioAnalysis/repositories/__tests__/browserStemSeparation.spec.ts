import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { separateStemsBrowser } from '../browserStemSeparation';

// onnxruntime-web is dynamically imported inside getSession(); mock it so we
// can count how many inference sessions get created across concurrent calls.
const createSessionMock = vi.fn(() =>
    Promise.resolve({
        run: vi.fn(),
        release: vi.fn(),
    })
);

vi.mock('onnxruntime-web', () => ({
    InferenceSession: {
        create: (...args: unknown[]) => createSessionMock(...args),
    },
    Tensor: class {
        constructor(
            public type: string,
            public data: unknown,
            public dims: number[]
        ) {}
    },
}));

describe('separateStemsBrowser — concurrent session load', () => {
    let fetchMock: ReturnType<typeof vi.fn>;
    let originalFetch: typeof globalThis.fetch;
    let originalDecode: AudioContext['decodeAudioData'] | undefined;

    beforeEach(() => {
        createSessionMock.mockClear();

        // getModelBuffer() downloads the ~235MB model via fetch when the Cache
        // API is absent (jsdom has no `caches`). Count those downloads.
        originalFetch = globalThis.fetch;
        fetchMock = vi.fn(() =>
            Promise.resolve({
                ok: true,
                status: 200,
                arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)),
            })
        );
        globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

        // separateStemsBrowser decodes audio *after* getSession() resolves. The
        // jsdom AudioContext stub has no real decoder, so make decodeAudioData
        // reject — both concurrent calls then settle (rejected) right after the
        // shared session load, which is the only thing under test here.
        const proto = globalThis.AudioContext.prototype as unknown as {
            decodeAudioData?: AudioContext['decodeAudioData'];
        };
        originalDecode = proto.decodeAudioData;
        proto.decodeAudioData = vi.fn(() =>
            Promise.reject(new Error('decode-stop'))
        ) as unknown as AudioContext['decodeAudioData'];
    });

    afterEach(() => {
        globalThis.fetch = originalFetch;
        const proto = globalThis.AudioContext.prototype as unknown as {
            decodeAudioData?: AudioContext['decodeAudioData'];
        };
        if (originalDecode) {
            proto.decodeAudioData = originalDecode;
        } else {
            delete proto.decodeAudioData;
        }
        // The module-level session holder caches across calls within a module
        // instance; reset it so each test starts cold.
        vi.resetModules();
    });

    it('downloads the model and creates the session exactly once under two concurrent first calls', async () => {
        const audio = new ArrayBuffer(16);

        // Fire two callers before either has finished loading the session. With
        // the in-flight promise memoized, both await one load; without it, each
        // caller independently downloads the 235MB model and builds a second
        // InferenceSession (the OOM race this test guards against).
        const calls = await Promise.allSettled([
            separateStemsBrowser(audio, ['vocals']),
            separateStemsBrowser(audio, ['vocals']),
        ]);

        // Both calls reached the audio-decode step (proving both passed through
        // getSession) and bailed there via our injected rejection.
        expect(calls.every((settled) => settled.status === 'rejected')).toBe(true);

        // The race-safety guarantee: one download, one session creation.
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(createSessionMock).toHaveBeenCalledTimes(1);
    });
});
