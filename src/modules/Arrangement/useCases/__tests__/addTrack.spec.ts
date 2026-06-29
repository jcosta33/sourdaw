import { describe, it, expect, vi, beforeEach } from 'vitest';

import { injectDependencies } from '#/infra/di/testing/injectDependencies';

import { getTrackState } from '../../repositories/track/getTrackState';
import { setTrackState } from '../../repositories/track/setTrackState';
import { addTrack } from '../addTrack';

import type { Track, TrackKind } from '../../models/Track';
import type { TrackState } from '../../repositories/track/getTrackState';

vi.mock('../../repositories/track/getTrackState', () => ({
    getTrackState: vi.fn<typeof getTrackState>(),
}));
vi.mock('../../repositories/track/setTrackState', () => ({
    setTrackState: vi.fn<typeof setTrackState>(),
}));

const mockEventBus = {
    emit: vi.fn(),
};

describe('addTrack', () => {
    beforeEach(() => {
        injectDependencies(addTrack, { eventBus: mockEventBus });
        vi.mocked(getTrackState).mockReset();
        vi.mocked(setTrackState).mockReset();
        mockEventBus.emit.mockReset();
    });

    it('should return null and not emit when track state is missing', () => {
        vi.mocked(getTrackState).mockReturnValue(null);

        expect(addTrack({ name: 'Drums', kind: 'audio' as TrackKind })).toBeNull();
        expect(mockEventBus.emit).not.toHaveBeenCalled();
        expect(setTrackState).not.toHaveBeenCalled();
    });

    it('should append track, update state, and emit track.added', () => {
        vi.mocked(getTrackState).mockReturnValue({ tracks: [], selectedTrackId: null } as unknown as TrackState);

        const result = addTrack({ name: 'Lead', kind: 'midi' } as unknown as Track);

        expect(result).not.toBeNull();
        expect(setTrackState).toHaveBeenCalled();
        expect(mockEventBus.emit).toHaveBeenCalledWith(
            'track.added',
            expect.objectContaining({ name: 'Lead', kind: 'midi', trackId: result!.id })
        );
    });
});
