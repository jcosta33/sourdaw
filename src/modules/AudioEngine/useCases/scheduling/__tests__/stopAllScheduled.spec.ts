import { describe, it, expect, vi, beforeEach } from 'vitest';
import { audioEngine } from '../../../repositories/createWebAudioEngine';
import { stopAllScheduled } from '../stopAllScheduled';

vi.mock('../../../repositories/createWebAudioEngine', () => ({
    audioEngine: {
        stopAllScheduled: vi.fn(),
    },
}));

describe('stopAllScheduled', () => {
    beforeEach(() => {
        vi.mocked(audioEngine.stopAllScheduled).mockClear();
    });

    it('should forward to the audio engine', () => {
        stopAllScheduled();

        expect(audioEngine.stopAllScheduled).toHaveBeenCalledTimes(1);
    });
});
