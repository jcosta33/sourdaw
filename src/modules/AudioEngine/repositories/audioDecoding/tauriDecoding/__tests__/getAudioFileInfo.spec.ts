import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getAudioFileInfo } from '../getAudioFileInfo';
import { isTauri, tauriInvoke } from '#/utils/tauriBridge';

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

        expect(tauriInvoke).toHaveBeenCalledWith('get_audio_file_info', { path: '/test.wav' });
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
});
