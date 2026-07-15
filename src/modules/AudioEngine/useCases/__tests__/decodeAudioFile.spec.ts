import { beforeEach, describe, expect, it, vi } from 'vitest';

import * as subject from '../decodeAudioFile';

const mocks = vi.hoisted(() => ({
    logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    decodeAudioData: vi.fn(),
    decodeAudioBytesWasm: vi.fn(),
    wasmDecodedToAudioBuffer: vi.fn(),
    bufferCacheSet: vi.fn(),
}));

vi.mock('#/infra/logger/appLogger', () => ({
    logger: mocks.logger,
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
            decodeAudioData: mocks.decodeAudioData,
        },
    },
}));

vi.mock('../../stores/audioBufferCache', () => ({
    audioBufferCache: { set: mocks.bufferCacheSet },
}));

function makeFile(name: string): File {
    return new File([new Uint8Array(8)], name, { type: 'audio/wav' });
}

describe('decodeAudioFile', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.decodeAudioData.mockResolvedValue({ duration: 2 } as AudioBuffer);
        mocks.decodeAudioBytesWasm.mockResolvedValue(null);
        mocks.wasmDecodedToAudioBuffer.mockReturnValue({ duration: 3 } as AudioBuffer);
    });

    it('uses Web Audio first and caches the decoded AudioBuffer', async () => {
        const webBuffer = { duration: 2 } as AudioBuffer;
        mocks.decodeAudioData.mockResolvedValue(webBuffer);

        const result = await subject.decodeAudioFile(makeFile('song.wav'));

        expect(mocks.decodeAudioData).toHaveBeenCalledWith(expect.any(ArrayBuffer));
        expect(mocks.decodeAudioBytesWasm).not.toHaveBeenCalled();
        expect(result.buffer).toBe(webBuffer);
        expect(mocks.bufferCacheSet).toHaveBeenCalledWith(expect.stringMatching(/^audio-/), webBuffer);
    });

    it('falls back to Symphonia WASM when Web Audio rejects the file', async () => {
        const webError = new Error('unsupported browser codec');
        const wasmDecoded = {
            interleaved: new Float32Array([0.1, 0.5, 0.2, 0.6]),
            sampleRate: 48_000,
            channels: 2,
            totalFrames: 2,
        };
        const wasmBuffer = { duration: 2 } as AudioBuffer;
        mocks.decodeAudioData.mockRejectedValue(webError);
        mocks.decodeAudioBytesWasm.mockResolvedValue(wasmDecoded);
        mocks.wasmDecodedToAudioBuffer.mockReturnValue(wasmBuffer);

        const result = await subject.decodeAudioFile(makeFile('song.flac'));

        expect(mocks.decodeAudioBytesWasm).toHaveBeenCalledWith(expect.any(ArrayBuffer));
        expect(mocks.wasmDecodedToAudioBuffer).toHaveBeenCalledWith(wasmDecoded, expect.anything());
        expect(result.buffer).toBe(wasmBuffer);
        expect(mocks.bufferCacheSet).toHaveBeenCalledWith(expect.stringMatching(/^audio-/), wasmBuffer);
        expect(mocks.logger.warn).toHaveBeenCalledWith(
            '[decodeAudioFile] Web Audio decode failed for "song.flac" — trying Symphonia WASM decoder:',
            webError
        );
    });

    it('throws a DecodeError when both browser decoders reject the file', async () => {
        const webError = new Error('unsupported browser codec');
        mocks.decodeAudioData.mockRejectedValue(webError);

        await expect(subject.decodeAudioFile(makeFile('broken.flac'))).rejects.toMatchObject({
            _tag: 'Decode',
            message: 'Unable to decode "broken.flac" — format not supported.',
        });

        expect(mocks.logger.warn).toHaveBeenCalledWith(
            '[decodeAudioFile] Web Audio decode failed for "broken.flac" — trying Symphonia WASM decoder:',
            webError
        );
    });
});
