import { describe, it, expect, vi, beforeEach } from 'vitest';

import { audioEngine } from '../../../repositories/createWebAudioEngine';
import { scheduleTrackPan } from '../scheduleTrackPan';

vi.mock('../../../repositories/createWebAudioEngine', () => ({
    audioEngine: { scheduleTrackPan: vi.fn() },
}));

describe('scheduleTrackPan', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('forwards trackId, the canonical pan value, and the land time to the engine', () => {
        scheduleTrackPan('track-3', 37.5, 4.5);

        expect(audioEngine.scheduleTrackPan).toHaveBeenCalledTimes(1);
        expect(audioEngine.scheduleTrackPan).toHaveBeenCalledWith('track-3', 37.5, 4.5);
    });
});
