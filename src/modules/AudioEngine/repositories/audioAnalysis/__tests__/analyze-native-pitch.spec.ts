import { beforeEach, describe, expect, it, vi } from 'vitest';

import { isDesktopRuntime, desktopInvoke } from '#/utils/desktopBridge';

import { analyzeNativePitch } from '../analyze-native-pitch';

vi.mock('#/utils/desktopBridge', () => ({
    isDesktopRuntime: vi.fn(() => true),
    desktopInvoke: vi.fn(),
}));

describe('analyzeNativePitch', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(isDesktopRuntime).mockReturnValue(true);
    });

    it('should invoke the native pitch command with the audio path', async () => {
        const contour = {
            points: [{ time_ms: 0, frequency_hz: 440, confidence: 0.9, voiced: true }],
            sample_rate: 44100,
            hop_size: 256,
            algorithm: 'pyin',
        };
        vi.mocked(desktopInvoke).mockResolvedValue(contour);

        const result = await analyzeNativePitch({ analysisId: 'analysis-1', audioPath: 'clip-audio.wav' });

        expect(desktopInvoke).toHaveBeenCalledWith('analyze_pitch', {
            analysisId: 'analysis-1',
            audioPath: 'clip-audio.wav',
        });
        expect(result).toEqual(contour);
    });

    it('should reject invalid native pitch payloads', async () => {
        vi.mocked(desktopInvoke).mockResolvedValue({
            points: [{ time_ms: 0, frequency_hz: '440', confidence: 0.9, voiced: true }],
            sample_rate: 44100,
            hop_size: 256,
            algorithm: 'pyin',
        });

        await expect(analyzeNativePitch({ analysisId: 'analysis-1', audioPath: 'clip-audio.wav' })).rejects.toThrow(
            'analyze_pitch returned an invalid payload'
        );
    });

    it('should return null without invoking native analysis outside the desktop runtime', async () => {
        vi.mocked(isDesktopRuntime).mockReturnValue(false);

        const result = await analyzeNativePitch({ analysisId: 'analysis-1', audioPath: 'clip-audio.wav' });

        expect(result).toBeNull();
        expect(desktopInvoke).not.toHaveBeenCalled();
    });
});
