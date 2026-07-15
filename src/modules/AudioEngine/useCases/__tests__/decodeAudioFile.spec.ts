import { describe, it, expect, beforeEach, vi } from 'vitest';

import * as subject from '../decodeAudioFile';

const mocks = vi.hoisted(() => ({
    logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    writeAudioFileToCache: vi.fn(),
    nativeDecode: vi.fn(),
    samplesToAudioBuffer: vi.fn(),
    decodeAudioBytesWasm: vi.fn(),
    wasmDecodedToAudioBuffer: vi.fn(),
    bufferCacheSet: vi.fn(),
}));

vi.mock('#/infra/logger/appLogger', () => ({
    logger: mocks.logger,
}));

vi.mock('../../repositories/audioDecoding/tauriDecoding/writeAudioFileToCache', () => ({
    writeAudioFileToCache: mocks.writeAudioFileToCache,
}));

vi.mock('../../repositories/audioDecoding/tauriDecoding/decodeAudioFile', () => ({
    decodeAudioFile: mocks.nativeDecode,
}));

vi.mock('../../repositories/audioDecoding/samplesToAudioBuffer', () => ({
    samplesToAudioBuffer: mocks.samplesToAudioBuffer,
}));

vi.mock('../../repositories/audioDecoding/wasmDecoding/decodeAudioBytesWasm', () => ({
    decodeAudioBytesWasm: mocks.decodeAudioBytesWasm,
}));

vi.mock('../../repositories/audioDecoding/wasmDecoding/wasmDecodedToAudioBuffer', () => ({
    wasmDecodedToAudioBuffer: mocks.wasmDecodedToAudioBuffer,
}));

vi.mock('../../repositories/createWebAudioEngine', () => ({
    audioEngine: {
        context: {
            decodeAudioData: vi.fn(() => Promise.reject(new Error('no native decode in test'))),
        },
    },
}));

vi.mock('../../stores/audioBufferCache', () => ({
    audioBufferCache: { set: mocks.bufferCacheSet },
}));

function makeFile(name: string): File {
    return new File([new Uint8Array(8)], name);
}

describe('decodeAudioFile — native decode path', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.writeAudioFileToCache.mockResolvedValue({ kind: 'ready', path: '/app/models/../cache/song.flac' });
        mocks.nativeDecode.mockResolvedValue(null);
        mocks.decodeAudioBytesWasm.mockResolvedValue({ sampleRate: 48_000, channels: [new Float32Array(4)] });
        mocks.wasmDecodedToAudioBuffer.mockReturnValue({} as AudioBuffer);
    });

    it('does not log a "Tauri unavailable" warning when the repository skips native decode outside Tauri', async () => {
        mocks.writeAudioFileToCache.mockResolvedValue({ kind: 'skipped' });

        const result = await subject.decodeAudioFile(makeFile('song.flac'));

        expect(result).toBeDefined();
        expect(mocks.nativeDecode).not.toHaveBeenCalled();
        expect(mocks.wasmDecodedToAudioBuffer).toHaveBeenCalled();
        expect(mocks.logger.warn).not.toHaveBeenCalled();
    });

    it('returns decoded native samples when cache write and native decode succeed', async () => {
        const nativeBuffer = {} as AudioBuffer;
        mocks.nativeDecode.mockResolvedValue({
            samples: [0.1, 0.2],
            sampleRate: 48_000,
            channels: 2,
            durationMs: 1,
            totalFrames: 2,
        });
        mocks.samplesToAudioBuffer.mockReturnValue(nativeBuffer);

        const result = await subject.decodeAudioFile(makeFile('song.flac'));

        expect(mocks.writeAudioFileToCache).toHaveBeenCalled();
        expect(mocks.nativeDecode).toHaveBeenCalledWith('/app/models/../cache/song.flac');
        expect(mocks.samplesToAudioBuffer).toHaveBeenCalled();
        expect(result.buffer).toBe(nativeBuffer);
        expect(mocks.bufferCacheSet).toHaveBeenCalledWith(expect.stringMatching(/^audio-/), nativeBuffer);
        expect(mocks.decodeAudioBytesWasm).not.toHaveBeenCalled();
    });

    it('logs a "Tauri unavailable" warning when the bridge cannot load, then falls back', async () => {
        const bridgeError = new Error('missing tauri bridge');
        mocks.writeAudioFileToCache.mockResolvedValue({ kind: 'unavailable', error: bridgeError });

        const result = await subject.decodeAudioFile(makeFile('song.flac'));

        expect(result).toBeDefined();
        expect(mocks.nativeDecode).not.toHaveBeenCalled();
        expect(mocks.wasmDecodedToAudioBuffer).toHaveBeenCalled();
        expect(mocks.logger.warn).toHaveBeenCalledWith(
            '[decodeAudioFile] Tauri unavailable — falling back to browser decoder:',
            bridgeError
        );
    });

    it('logs a "Tauri decoder failed" warning when the cache write throws, then falls back', async () => {
        const cacheError = new Error('write failed');
        mocks.writeAudioFileToCache.mockRejectedValue(cacheError);

        const result = await subject.decodeAudioFile(makeFile('song.flac'));

        expect(result).toBeDefined();
        expect(mocks.nativeDecode).not.toHaveBeenCalled();
        expect(mocks.wasmDecodedToAudioBuffer).toHaveBeenCalled();
        expect(mocks.logger.warn).toHaveBeenCalledWith(
            '[decodeAudioFile] Tauri decoder failed for "song.flac" — falling back to browser decoder:',
            cacheError
        );
    });

    it('logs a "Tauri decoder failed" warning when the native decode throws, then falls back', async () => {
        mocks.nativeDecode.mockRejectedValue(new Error('symphonia boom'));

        const result = await subject.decodeAudioFile(makeFile('song.flac'));

        // Fell back to the WASM decoder rather than throwing.
        expect(result).toBeDefined();
        expect(mocks.wasmDecodedToAudioBuffer).toHaveBeenCalled();

        // The swallowed error is now surfaced, tagged as a decoder failure.
        expect(mocks.logger.warn).toHaveBeenCalledWith(
            '[decodeAudioFile] Tauri decoder failed for "song.flac" — falling back to browser decoder:',
            expect.any(Error)
        );
    });

    it('warns and falls back when the native decoder returns no samples', async () => {
        // decoded === null is a non-throwing "decoder produced nothing" outcome —
        // previously this fell through silently with no record.
        mocks.nativeDecode.mockResolvedValue(null);

        const result = await subject.decodeAudioFile(makeFile('song.flac'));

        expect(result).toBeDefined();
        expect(mocks.wasmDecodedToAudioBuffer).toHaveBeenCalled();
        const warnedNoSamples = mocks.logger.warn.mock.calls.some(
            ([msg]) => typeof msg === 'string' && msg.includes('returned no samples')
        );
        expect(warnedNoSamples).toBe(true);
    });

    it('falls back when the native decoder returns an empty decoded buffer', async () => {
        mocks.nativeDecode.mockResolvedValue({
            samples: [],
            sampleRate: 48_000,
            channels: 2,
            durationMs: 0,
            totalFrames: 0,
        });

        const result = await subject.decodeAudioFile(makeFile('song.flac'));

        expect(result).toBeDefined();
        expect(mocks.samplesToAudioBuffer).not.toHaveBeenCalled();
        expect(mocks.wasmDecodedToAudioBuffer).toHaveBeenCalled();
        const warnedNoSamples = mocks.logger.warn.mock.calls.some(
            ([msg]) => typeof msg === 'string' && msg.includes('returned no samples')
        );
        expect(warnedNoSamples).toBe(true);
    });
});
