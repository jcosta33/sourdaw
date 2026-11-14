import { describe, it, expect, vi, beforeEach } from 'vitest';

import { getTrackState } from '../../repositories/track/getTrackState';
import { setTrackState } from '../../repositories/track/setTrackState';
import { addTrack } from '../addTrack';

import type { TrackState } from '../../repositories/track/getTrackState';

vi.mock('../../repositories/track/getTrackState', () => ({
    getTrackState: vi.fn<typeof getTrackState>(),
}));
vi.mock('../../repositories/track/setTrackState', () => ({
    setTrackState: vi.fn<typeof setTrackState>(),
}));

function createTrackState(overrides: Partial<TrackState> = {}): TrackState {
    return { tracks: [], selectedTrackId: null, ghostClips: [], ...overrides };
}

describe('addTrack', () => {
    beforeEach(() => {
        vi.mocked(getTrackState).mockReset();
        vi.mocked(setTrackState).mockReset();
    });

    it('should return null and not write when track state is missing', () => {
        vi.mocked(getTrackState).mockReturnValue(null);

        expect(addTrack({ name: 'Drums', kind: 'audio' })).toBeNull();
        expect(setTrackState).not.toHaveBeenCalled();
    });

    it('should append track and select it by default', () => {
        vi.mocked(getTrackState).mockReturnValue(createTrackState());

        const result = addTrack({ name: 'Lead', kind: 'midi' });

        expect(result).not.toBeNull();
        expect(setTrackState).toHaveBeenCalledWith({
            tracks: [result],
            selectedTrackId: result!.id,
            ghostClips: [],
        });
        expect(result).toMatchObject({ name: 'Lead', kind: 'midi' });
    });

    it('should append track without changing selection when selection is disabled', () => {
        vi.mocked(getTrackState).mockReturnValue(createTrackState({ selectedTrackId: 'track-existing' }));

        const result = addTrack({ name: 'Master', kind: 'master', select: false });

        expect(result).not.toBeNull();
        expect(setTrackState).toHaveBeenCalledWith({
            tracks: [result],
            selectedTrackId: 'track-existing',
            ghostClips: [],
        });
        expect(result).toMatchObject({ name: 'Master', kind: 'master' });
    });
});
