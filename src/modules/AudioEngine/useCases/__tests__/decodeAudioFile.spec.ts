import { describe, it, expect, beforeEach, vi } from 'vitest';

import * as subject from '../decodeAudioFile';

const mocks = vi.hoisted(() => ({
    isTauri: vi.fn(() => false),
    logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    invoke: vi.fn(),
    nativeDecode: vi.fn(),
    samplesToAudioBuffer: vi.fn(),
    decodeAudioBytesWasm: vi.fn(),
    wasmDecodedToAudioBuffer: vi.fn(),
    bufferCacheSet: vi.fn(),
}));

vi.mock('#/utils/tauriBridge', () => ({
    isTauri: mocks.isTauri,
}));

vi.mock('#/infra/logger/appLogger', () => ({
    logger: mocks.logger,
}));

vi.mock('@tauri-apps/api/core', () => ({
    invoke: mocks.invoke,
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
    const file = {
        name,
        arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)),
    };
    return file as unknown as File;
}

describe('sanitizeCacheFileName', () => {
    it('keeps a plain filename unchanged', () => {
        expect(subject.sanitizeCacheFileName('track.wav')).toBe('track.wav');
    });

    it('strips POSIX directory traversal components', () => {
        expect(subject.sanitizeCacheFileName('../../etc/passwd')).toBe('passwd');
        expect(subject.sanitizeCacheFileName('../cache/x.wav')).toBe('x.wav');
    });

    it('strips Windows directory traversal components', () => {
        expect(subject.sanitizeCacheFileName('..\\..\\windows\\system32\\evil.wav')).toBe('evil.wav');
    });

    it('falls back to a safe default for pure-dot or empty names', () => {
        expect(subject.sanitizeCacheFileName('..')).toBe('audio-file');
        expect(subject.sanitizeCacheFileName('')).toBe('audio-file');
        expect(subject.sanitizeCacheFileName('a/../')).toBe('audio-file');
    });
});

describe('decodeAudioFile — Tauri path', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.isTauri.mockReturnValue(true);
        mocks.invoke.mockImplementation((cmd: string) => {
            if (cmd === 'get_model_dir') {
                return Promise.resolve('/app/models');
            }
            return Promise.resolve(undefined);
        });
        mocks.nativeDecode.mockResolvedValue(null);
        mocks.decodeAudioBytesWasm.mockResolvedValue({ sampleRate: 48_000, channels: [new Float32Array(4)] });
        mocks.wasmDecodedToAudioBuffer.mockReturnValue({} as AudioBuffer);
    });

    it('does not write outside the cache directory for a traversal filename', async () => {
        await subject.decodeAudioFile(makeFile('../../../../etc/passwd'));

        const writeCall = mocks.invoke.mock.calls.find(([cmd]) => cmd === 'write_audio_file');
        expect(writeCall).toBeDefined();
        const writtenPath = (writeCall![1] as { path: string }).path;

        // The cache dir is `<modelDir>/../cache/`. A hostile name must not add
        // further `..` segments that escape it.
        expect(writtenPath).toBe('/app/models/../cache/passwd');
        expect(writtenPath).not.toContain('passwd/..');
        expect(writtenPath.endsWith('/passwd')).toBe(true);
    });

    it('logs a "Tauri decoder failed" warning when the native decode throws, then falls back', async () => {
        mocks.nativeDecode.mockRejectedValue(new Error('symphonia boom'));

        const result = await subject.decodeAudioFile(makeFile('song.flac'));

        // Fell back to the WASM decoder rather than throwing.
        expect(result).toBeDefined();
        expect(mocks.wasmDecodedToAudioBuffer).toHaveBeenCalled();

        // The swallowed error is now surfaced, tagged as a decoder failure.
        const warnedDecoderFailure = mocks.logger.warn.mock.calls.some(
            ([msg]) => typeof msg === 'string' && msg.includes('Tauri decoder failed')
        );
        expect(warnedDecoderFailure).toBe(true);
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
});
