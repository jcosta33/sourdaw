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
        mocks.decodeAudioData.mockResolvedValue({ duration: 2 });
        mocks.decodeAudioBytesWasm.mockResolvedValue(null);
        mocks.wasmDecodedToAudioBuffer.mockReturnValue({ duration: 3 });
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

    it('re-reads the File after Web Audio detaches its input before rejecting', async () => {
        const webError = new Error('unsupported browser codec');
        const firstInput = new ArrayBuffer(4);
        const secondInput = new ArrayBuffer(4);
        new Uint8Array(firstInput).set([1, 2, 3, 4]);
        new Uint8Array(secondInput).set([5, 6, 7, 8]);

        const file = makeFile('song.flac');
        const arrayBuffer = vi
            .spyOn(file, 'arrayBuffer')
            .mockResolvedValueOnce(firstInput)
            .mockResolvedValueOnce(secondInput);
        const wasmDecoded = {
            interleaved: new Float32Array([0.1, 0.5, 0.2, 0.6]),
            sampleRate: 48_000,
            channels: 2,
            totalFrames: 2,
        };
        const wasmBuffer = { duration: 2 } as AudioBuffer;
        let webAudioInput: ArrayBuffer | undefined;
        let wasmInput: ArrayBuffer | undefined;
        mocks.decodeAudioData.mockImplementation((input: ArrayBuffer) => {
            webAudioInput = input;
            structuredClone(input, { transfer: [input] });
            return Promise.reject(webError);
        });
        mocks.decodeAudioBytesWasm.mockImplementation((input: ArrayBuffer) => {
            wasmInput = input;
            return Promise.resolve(wasmDecoded);
        });
        mocks.wasmDecodedToAudioBuffer.mockReturnValue(wasmBuffer);

        const result = await subject.decodeAudioFile(file);

        expect(arrayBuffer).toHaveBeenCalledTimes(2);
        expect(webAudioInput).toBe(firstInput);
        expect(firstInput.byteLength).toBe(0);
        expect(wasmInput).toBe(secondInput);
        expect(wasmInput).not.toBe(firstInput);
        if (wasmInput === undefined) {
            throw new Error('WASM decoder did not receive an ArrayBuffer');
        }
        expect(new Uint8Array(wasmInput)).toEqual(new Uint8Array([5, 6, 7, 8]));
        expect(result.buffer).toBe(wasmBuffer);
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
