import { describe, it, expect, vi, beforeEach } from 'vitest';

import { audioBufferToMp3 as encode } from '../../repositories/audioEncoders/mp3Encoder';
import { audioBufferToMp3 } from '../audioBufferToMp3';

vi.mock('../../repositories/audioEncoders/mp3Encoder', () => ({
    audioBufferToMp3: vi.fn(),
}));

describe('audioBufferToMp3', () => {
    beforeEach(() => {
        vi.mocked(encode).mockReset();
    });

    it('should delegate to the MP3 encoder with the same arguments', async () => {
        const buffer = {} as AudioBuffer;
        const out = new Uint8Array([1, 2, 3]);
        const onProgress = vi.fn();
        vi.mocked(encode).mockResolvedValue(out);

        await expect(audioBufferToMp3(buffer, 192, onProgress)).resolves.toBe(out);
        expect(encode).toHaveBeenCalledWith(buffer, 192, onProgress);
    });

    it('should default bitrate to 128 and omit progress when not provided', async () => {
        const buffer = {} as AudioBuffer;
        const out = new Uint8Array();
        vi.mocked(encode).mockResolvedValue(out);

        await audioBufferToMp3(buffer);

        expect(encode).toHaveBeenCalledWith(buffer, 128, undefined);
    });
});
