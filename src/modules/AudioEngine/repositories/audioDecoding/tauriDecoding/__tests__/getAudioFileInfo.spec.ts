import { describe, it, expect, vi, beforeEach } from 'vitest';

import { isTauri, tauriInvoke } from '#/utils/tauriBridge';

import { getAudioFileInfo } from '../getAudioFileInfo';

vi.mock('#/utils/tauriBridge', () => ({
    isTauri: vi.fn(),
    tauriInvoke: vi.fn(),
}));

describe('getAudioFileInfo repository', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should return null in browser', async () => {
        vi.mocked(isTauri).mockReturnValue(false);
        const result = await getAudioFileInfo('/test.wav');
        expect(result).toBeNull();
        expect(tauriInvoke).not.toHaveBeenCalled();
    });

    it('should invoke Tauri and map the results', async () => {
        vi.mocked(isTauri).mockReturnValue(true);
        const mockRaw = {
            path: '/test.wav',
            name: 'test.wav',
            sample_rate: 44100,
            channels: 2,
            duration_ms: 1000,
            total_frames: 44100,
            codec: 'wav',
            size_bytes: 1024,
        };
        vi.mocked(tauriInvoke).mockResolvedValue(mockRaw);

        const result = await getAudioFileInfo('/test.wav');

        expect(tauriInvoke).toHaveBeenCalledWith('get_audio_file_info', { filePath: '/test.wav' });
        expect(result).toEqual({
            path: '/test.wav',
            name: 'test.wav',
            sampleRate: 44100,
            channels: 2,
            durationMs: 1000,
            totalFrames: 44100,
            codec: 'wav',
            sizeBytes: 1024,
        });
    });

    it('should reject malformed native responses instead of returning undefined fields', async () => {
        vi.mocked(isTauri).mockReturnValue(true);
        vi.mocked(tauriInvoke).mockResolvedValue({
            sample_rate: 44100,
            channels: 2,
            total_frames: 44100,
            codec: 'wav',
        });

        await expect(getAudioFileInfo('/test.wav')).rejects.toThrow('get_audio_file_info returned an invalid payload');
    });

    it('should propagate Tauri invocation errors', async () => {
        vi.mocked(isTauri).mockReturnValue(true);
        const error = new Error('metadata unavailable');
        vi.mocked(tauriInvoke).mockRejectedValue(error);

        await expect(getAudioFileInfo('/test.wav')).rejects.toBe(error);
    });
});
