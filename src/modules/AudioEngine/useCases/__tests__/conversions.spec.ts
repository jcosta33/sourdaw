import { describe, it, expect, vi, beforeEach } from 'vitest';

import { audioBufferToFlac } from '../audioBufferToFlac';
import { audioBufferToMp3 } from '../audioBufferToMp3';
import { audioBufferToWav } from '../audioBufferToWav';

const mocks = vi.hoisted(() => ({
    mp3Encode: vi.fn(),
    flacEncode: vi.fn(),
    wavEncode: vi.fn(),
}));

vi.mock('../../repositories/audioEncoders/mp3Encoder', () => ({
    audioBufferToMp3: mocks.mp3Encode,
}));

vi.mock('../../repositories/audioEncoders/flacEncoder', () => ({
    audioBufferToFlac: mocks.flacEncode,
}));

vi.mock('../../repositories/audioEncoders/wavEncoder', () => ({
    audioBufferToWav: mocks.wavEncode,
}));

describe('Audio Buffer Conversion Use Cases', () => {
    beforeEach(() => vi.clearAllMocks());

    it('audioBufferToMp3 delegates to encoder', async () => {
        const buffer = {} as any;
        function onProgress() {}
        await audioBufferToMp3(buffer, 192, onProgress);
        expect(mocks.mp3Encode).toHaveBeenCalledWith(buffer, 192, onProgress);
    });

    it('audioBufferToFlac delegates to encoder', async () => {
        const buffer = {} as any;
        function onProgress() {}
        await audioBufferToFlac(buffer, onProgress);
        expect(mocks.flacEncode).toHaveBeenCalledWith(buffer, onProgress);
    });

    it('audioBufferToWav delegates to encoder', async () => {
        const buffer = {} as any;
        await audioBufferToWav(buffer);
        expect(mocks.wavEncode).toHaveBeenCalledWith(buffer, 16, undefined);
    });
});
