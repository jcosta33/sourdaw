import { vi, describe, it, expect, beforeEach } from 'vitest';

import { isTauri, tauriInvoke } from '#/utils/tauriBridge';

import { decodeAudioFile } from '../decodeAudioFile';

vi.mock('#/utils/tauriBridge', () => ({
    isTauri: vi.fn(),
    tauriInvoke: vi.fn(),
}));

describe('decodeAudioFile', () => {
    beforeEach(() => {
        vi.resetAllMocks();
    });

    it('should return null when not in Tauri environment', async () => {
        vi.mocked(isTauri).mockReturnValue(false);
        const result = await decodeAudioFile('/path/to/audio.wav');
        expect(result).toBeNull();
        expect(tauriInvoke).not.toHaveBeenCalled();
    });

    it('should invoke Tauri and map the results when in Tauri environment', async () => {
        vi.mocked(isTauri).mockReturnValue(true);
        const mockRaw = {
            samples: [0.1, 0.2],
            sample_rate: 44100,
            channels: 2,
            duration_ms: 1000,
            total_frames: 44100,
        };
        vi.mocked(tauriInvoke).mockResolvedValue(mockRaw);

        const result = await decodeAudioFile('/path/to/audio.wav');

        expect(tauriInvoke).toHaveBeenCalledWith('decode_audio_file', { path: '/path/to/audio.wav' });
        expect(result).toEqual({
            samples: [0.1, 0.2],
            sampleRate: 44100,
            channels: 2,
            durationMs: 1000,
            totalFrames: 44100,
        });
    });
});
