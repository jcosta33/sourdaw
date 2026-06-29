import { beforeEach, describe, expect, it, vi } from 'vitest';

import { invoke } from '@tauri-apps/api/core';

import { analyzeNativePitch } from '../analyze-native-pitch';

vi.mock('@tauri-apps/api/core', () => ({
    invoke: vi.fn(),
}));

describe('analyzeNativePitch', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should invoke the native pitch command with the audio path', async () => {
        const contour = {
            points: [{ time_ms: 0, frequency_hz: 440, confidence: 0.9, voiced: true }],
            sample_rate: 44100,
            hop_size: 256,
            algorithm: 'pyin',
        };
        vi.mocked(invoke).mockResolvedValue(contour);

        const result = await analyzeNativePitch({ audioPath: 'clip-audio.wav' });

        expect(invoke).toHaveBeenCalledWith('analyze_pitch', {
            audioPath: 'clip-audio.wav',
        });
        expect(result).toEqual(contour);
    });

    it('should reject invalid native pitch payloads', async () => {
        vi.mocked(invoke).mockResolvedValue({
            points: [{ time_ms: 0, frequency_hz: '440', confidence: 0.9, voiced: true }],
            sample_rate: 44100,
            hop_size: 256,
            algorithm: 'pyin',
        });

        await expect(analyzeNativePitch({ audioPath: 'clip-audio.wav' })).rejects.toThrow(
            'analyze_pitch returned an invalid payload'
        );
    });
});
