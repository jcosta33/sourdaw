import { describe, it, expect, vi, beforeEach } from 'vitest';

import { injectDependencies } from '#/infra/di/testing/injectDependencies';

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

        expect(addTrack({ name: 'Drums', kind: 'audio' })).toBeNull();
        expect(mockEventBus.emit).not.toHaveBeenCalled();
        expect(setTrackState).not.toHaveBeenCalled();
    });

    it('should append track, select it by default, and emit track.added', () => {
        vi.mocked(getTrackState).mockReturnValue({ tracks: [], selectedTrackId: null } as unknown as TrackState);

        const result = addTrack({ name: 'Lead', kind: 'midi' });

        expect(result).not.toBeNull();
        expect(setTrackState).toHaveBeenCalledWith({
            tracks: [result],
            selectedTrackId: result!.id,
        });
        expect(mockEventBus.emit).toHaveBeenCalledWith(
            'track.added',
            expect.objectContaining({ name: 'Lead', kind: 'midi', trackId: result!.id })
        );
    });

    it('should append track without emitting when the added event is suppressed', () => {
        vi.mocked(getTrackState).mockReturnValue({ tracks: [], selectedTrackId: null } as unknown as TrackState);

        const result = addTrack({ name: 'Lead copy', kind: 'midi', suppressAddedEvent: true });

        expect(result).not.toBeNull();
        expect(setTrackState).toHaveBeenCalledWith({
            tracks: [result],
            selectedTrackId: result!.id,
        });
        expect(mockEventBus.emit).not.toHaveBeenCalled();
    });

    it('should append track without changing selection when selection is disabled', () => {
        vi.mocked(getTrackState).mockReturnValue({
            tracks: [],
            selectedTrackId: 'track-existing',
        } as unknown as TrackState);

        const result = addTrack({ name: 'Master', kind: 'master', select: false });

        expect(result).not.toBeNull();
        expect(setTrackState).toHaveBeenCalledWith({
            tracks: [result],
            selectedTrackId: 'track-existing',
        });
        expect(mockEventBus.emit).toHaveBeenCalledWith(
            'track.added',
            expect.objectContaining({ name: 'Master', kind: 'master', trackId: result!.id })
        );
    });
});
