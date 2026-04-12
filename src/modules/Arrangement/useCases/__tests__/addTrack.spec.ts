import { describe, it, expect, vi, beforeEach } from 'vitest';
import { addTrack } from '../addTrack';
import { getTrackState } from '../../repositories/track/getTrackState';
import { setTrackState } from '../../repositories/track/setTrackState';
import { eventBus } from '#/app/registerDependencies';

vi.mock('../../repositories/track/getTrackState', () => ({
    getTrackState: vi.fn(),
}));
vi.mock('../../repositories/track/setTrackState', () => ({
    setTrackState: vi.fn(),
}));
vi.mock('#/app/registerDependencies', async (importOriginal) => {
    const actual = await importOriginal<typeof import('#/app/registerDependencies')>();
    return {
        ...actual,
        eventBus: {
            ...actual.eventBus,
            emit: vi.fn(),
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

        expect(addTrack({ name: 'Drums', kind: 'audio' })).toBeNull();
        expect(eventBus.emit).not.toHaveBeenCalled();
        expect(setTrackState).not.toHaveBeenCalled();
    });

    it('should append track, update state, and emit track.added', () => {
        vi.mocked(getTrackState).mockReturnValue({ tracks: [], selectedTrackId: null } as any);

        const result = addTrack({ name: 'Lead', kind: 'midi' } as any);

        expect(result).not.toBeNull();
        expect(setTrackState).toHaveBeenCalled();
        expect(eventBus.emit).toHaveBeenCalledWith(
            'track.added',
            expect.objectContaining({ name: 'Lead', kind: 'midi', trackId: result!.id })
        );
    });
});
