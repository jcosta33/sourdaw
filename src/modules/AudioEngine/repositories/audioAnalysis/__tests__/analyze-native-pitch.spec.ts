import { beforeEach, describe, expect, it, vi } from 'vitest';

import { isTauri, tauriInvoke } from '#/utils/tauriBridge';

import { analyzeNativePitch } from '../analyze-native-pitch';

vi.mock('#/utils/tauriBridge', () => ({
    isTauri: vi.fn(() => true),
    tauriInvoke: vi.fn(),
}));

describe('analyzeNativePitch', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(isTauri).mockReturnValue(true);
    });

    it('should invoke the native pitch command with the audio path', async () => {
        const contour = {
            points: [{ time_ms: 0, frequency_hz: 440, confidence: 0.9, voiced: true }],
            sample_rate: 44100,
            hop_size: 256,
            algorithm: 'pyin',
        };
        vi.mocked(tauriInvoke).mockResolvedValue(contour);

        const result = await analyzeNativePitch({ analysisId: 'analysis-1', audioPath: 'clip-audio.wav' });

        expect(tauriInvoke).toHaveBeenCalledWith('analyze_pitch', {
            analysisId: 'analysis-1',
            audioPath: 'clip-audio.wav',
        });
        expect(result).toEqual(contour);
    });

    it('should reject invalid native pitch payloads', async () => {
        vi.mocked(tauriInvoke).mockResolvedValue({
            points: [{ time_ms: 0, frequency_hz: '440', confidence: 0.9, voiced: true }],
            sample_rate: 44100,
            hop_size: 256,
            algorithm: 'pyin',
        });

        await expect(analyzeNativePitch({ analysisId: 'analysis-1', audioPath: 'clip-audio.wav' })).rejects.toThrow(
            'analyze_pitch returned an invalid payload'
        );
    });

    it('should return null without invoking native analysis outside Tauri', async () => {
        vi.mocked(isTauri).mockReturnValue(false);

        const result = await analyzeNativePitch({ analysisId: 'analysis-1', audioPath: 'clip-audio.wav' });

        expect(result).toBeNull();
        expect(tauriInvoke).not.toHaveBeenCalled();
    });
});
