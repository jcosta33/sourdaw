import { describe, it, expect, vi, beforeEach } from 'vitest';

import { eventBus } from '#/app/registerDependencies';

import type { Track, TrackKind } from '../../models/Track';
import type { TrackState } from '../../repositories/track/getTrackState';
import { getTrackState } from '../../repositories/track/getTrackState';
import { setTrackState } from '../../repositories/track/setTrackState';
import { addTrack } from '../addTrack';

vi.mock('../../repositories/track/getTrackState', () => ({
    getTrackState: vi.fn<typeof getTrackState>(),
}));
vi.mock('../../repositories/track/setTrackState', () => ({
    setTrackState: vi.fn<typeof setTrackState>(),
}));
vi.mock('#/app/registerDependencies', async (importOriginal) => {
    const actual = await importOriginal<typeof import('#/app/registerDependencies')>();
    return {
        ...actual,
        eventBus: {
            ...actual.eventBus,
            emit: vi.fn<typeof eventBus.emit>(),
        },
    };
});

describe('addTrack', () => {
    beforeEach(() => {
        vi.mocked(getTrackState).mockReset();
        vi.mocked(setTrackState).mockReset();
        vi.mocked(eventBus.emit).mockReset();
    });

    it('should return null and not emit when track state is missing', () => {
        vi.mocked(getTrackState).mockReturnValue(null);

        expect(addTrack({ name: 'Drums', kind: 'audio' as TrackKind })).toBeNull();
        expect(eventBus.emit).not.toHaveBeenCalled();
        expect(setTrackState).not.toHaveBeenCalled();
    });

    it('should append track, update state, and emit track.added', () => {
        vi.mocked(getTrackState).mockReturnValue({ tracks: [], selectedTrackId: null } as unknown as TrackState);

        const result = addTrack({ name: 'Lead', kind: 'midi' } as unknown as Track);

        expect(result).not.toBeNull();
        expect(setTrackState).toHaveBeenCalled();
        expect(eventBus.emit).toHaveBeenCalledWith(
            'track.added',
            expect.objectContaining({ name: 'Lead', kind: 'midi', trackId: result!.id })
        );
    });
});
