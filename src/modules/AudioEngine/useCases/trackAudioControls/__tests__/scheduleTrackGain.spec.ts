import { describe, it, expect, vi, beforeEach } from 'vitest';

import { audioEngine } from '../../../repositories/createWebAudioEngine';
import { scheduleTrackGain } from '../scheduleTrackGain';

vi.mock('../../../repositories/createWebAudioEngine', () => ({
    audioEngine: { scheduleTrackGain: vi.fn() },
}));

describe('scheduleTrackGain', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('forwards trackId, gain, and the compensation-aligned land time to the engine', () => {
        scheduleTrackGain('track-7', 0.42, 12.25);

        expect(audioEngine.scheduleTrackGain).toHaveBeenCalledTimes(1);
        expect(audioEngine.scheduleTrackGain).toHaveBeenCalledWith('track-7', 0.42, 12.25);
    });
});
