import { describe, it, expect, vi, beforeEach } from 'vitest';

import { audioBufferToFlac as encode } from '../../repositories/audioEncoders/flacEncoder';
import { audioBufferToFlac } from '../audioBufferToFlac';

vi.mock('../../repositories/audioEncoders/flacEncoder', () => ({
    audioBufferToFlac: vi.fn(),
}));

describe('audioBufferToFlac', () => {
    beforeEach(() => {
        vi.mocked(encode).mockReset();
    });

    it('should delegate to the FLAC encoder with the same arguments', async () => {
        const buffer = {} as AudioBuffer;
        const out = new Uint8Array([0xff]);
        const onProgress = vi.fn();
        vi.mocked(encode).mockResolvedValue(out);

        await expect(audioBufferToFlac(buffer, 24, onProgress, { mode: 'tpdf', seed: 9 })).resolves.toBe(out);
        expect(encode).toHaveBeenCalledWith(buffer, 24, onProgress, { mode: 'tpdf', seed: 9 });
    });

    it('should default to 16-bit and omit progress when not provided', async () => {
        const buffer = {} as AudioBuffer;
        const out = new Uint8Array();
        vi.mocked(encode).mockResolvedValue(out);

        await audioBufferToFlac(buffer);

        expect(encode).toHaveBeenCalledWith(buffer, 16, undefined, undefined);
    });
});
