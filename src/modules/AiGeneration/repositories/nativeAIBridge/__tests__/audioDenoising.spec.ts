import { beforeEach, describe, expect, it, vi } from 'vitest';

import { denoiseAudio } from '../audioDenoising';
import { invokeAI } from '../invokeAI';

vi.mock('../invokeAI', () => ({
    invokeAI: vi.fn(),
}));

const ONE_LE = [0, 0, 0x80, 0x3f];
const NEGATIVE_ONE_LE = [0, 0, 0x80, 0xbf];

describe('denoiseAudio native payload', () => {
    beforeEach(() => {
        vi.mocked(invokeAI).mockReset();
        vi.mocked(invokeAI).mockResolvedValue({
            noise_floor_db: -60,
            processing_time_ms: 4,
            samples: new Uint8Array([...ONE_LE, ...NEGATIVE_ONE_LE]),
        });
    });

    it('sends samples as a trailing Float32 LE Buffer, not a JSON number array', async () => {
        await denoiseAudio(new Float32Array([1, -1]), 48_000, 1, 0.7);

        expect(invokeAI).toHaveBeenCalledTimes(1);
        const call = vi.mocked(invokeAI).mock.calls[0];
        if (call === undefined) {
            throw new Error('expected denoise_audio to be invoked');
        }
        const [command, args] = call;
        if (args === undefined) {
            throw new Error('expected denoise_audio arguments');
        }
        expect(command).toBe('denoise_audio');
        expect(args).toEqual({
            request: {
                channels: 1,
                sample_rate: 48_000,
                strength: 0.7,
            },
            samples: expect.any(Uint8Array),
        });
        const samples = args.samples;
        if (!(samples instanceof Uint8Array)) {
            throw new Error('expected samples to be a Uint8Array');
        }
        expect(Array.isArray(samples)).toBe(false);
        expect([...samples]).toEqual([...ONE_LE, ...NEGATIVE_ONE_LE]);
        expect(args.request).not.toHaveProperty('samples');
    });

    it('decodes the returned Buffer as Float32 LE samples', async () => {
        const result = await denoiseAudio(new Float32Array([0]), 48_000, 1, 0.5);

        expect([...result.samples]).toEqual([1, -1]);
        expect(result.samples).toBeInstanceOf(Float32Array);
        expect(result.noise_floor_db).toBe(-60);
        expect(result.processing_time_ms).toBe(4);
    });

    it('refuses a number-array sample payload in the native result', async () => {
        vi.mocked(invokeAI).mockResolvedValue({
            noise_floor_db: -60,
            processing_time_ms: 4,
            samples: [1, -1],
        });

        await expect(denoiseAudio(new Float32Array([1, -1]), 48_000, 1, 0.7)).rejects.toThrow(
            /Buffer, not a JSON number array/u
        );
    });
});
