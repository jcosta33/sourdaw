import { describe, it, expect, vi, beforeEach } from 'vitest';

import { denoiseAudio as denoiseAudioFromNativeBridge } from '../../../repositories/nativeAIBridge/audioDenoising';
import { denoiseAudio } from '../denoiseAudio';

vi.mock('../../../repositories/nativeAIBridge/audioDenoising', () => ({
    denoiseAudio: vi.fn(),
}));

describe('denoiseAudio', () => {
    beforeEach(() => {
        vi.mocked(denoiseAudioFromNativeBridge).mockReset();
    });

    it('should call the native bridge with default strength and return an owned result', async () => {
        const input_samples = new Float32Array([0.25, -0.5, 0.125]);
        const native_samples = new Float32Array([0.2, -0.4, 0.1]);
        vi.mocked(denoiseAudioFromNativeBridge).mockResolvedValue({
            samples: native_samples,
            noise_floor_db: -68,
            processing_time_ms: 14,
        });

        const result = await denoiseAudio(input_samples, 48_000, 2);

        expect(denoiseAudioFromNativeBridge).toHaveBeenCalledWith(input_samples, 48_000, 2, 0.7);
        expect(result).toEqual({
            samples: new Float32Array([0.2, -0.4, 0.1]),
            noise_floor_db: -68,
            processing_time_ms: 14,
        });
        expect(result.samples).not.toBe(native_samples);
    });

    it('should pass explicit strength through to the native bridge', async () => {
        const input_samples = new Float32Array([0.1, 0.05]);
        vi.mocked(denoiseAudioFromNativeBridge).mockResolvedValue({
            samples: new Float32Array([0.08, 0.04]),
            noise_floor_db: -72,
            processing_time_ms: 9,
        });

        await denoiseAudio(input_samples, 44_100, 1, 0.35);

        expect(denoiseAudioFromNativeBridge).toHaveBeenCalledWith(input_samples, 44_100, 1, 0.35);
    });
});
