import { describe, it, expect, vi, beforeEach } from 'vitest';

import { audioBufferToWav as encode } from '../../repositories/audioEncoders/wavEncoder';
import { audioBufferToWav } from '../audioBufferToWav';

vi.mock('../../repositories/audioEncoders/wavEncoder', () => ({
    audioBufferToWav: vi.fn(),
}));

describe('audioBufferToWav', () => {
    beforeEach(() => {
        vi.mocked(encode).mockReset();
    });

    it('should delegate to the WAV encoder with the same arguments', async () => {
        const buffer = {} as AudioBuffer;
        const out = new ArrayBuffer(8);
        const onProgress = vi.fn();
        vi.mocked(encode).mockResolvedValue(out);

        await expect(audioBufferToWav(buffer, 24, onProgress, { mode: 'tpdf', seed: 9 })).resolves.toBe(out);
        expect(encode).toHaveBeenCalledWith(buffer, 24, onProgress, { mode: 'tpdf', seed: 9 });
    });

    it('should default bit depth to 16 and omit progress when not provided', async () => {
        const buffer = {} as AudioBuffer;
        const out = new ArrayBuffer(0);
        vi.mocked(encode).mockResolvedValue(out);

        await audioBufferToWav(buffer);

        expect(encode).toHaveBeenCalledWith(buffer, 16, undefined, undefined);
    });
});
