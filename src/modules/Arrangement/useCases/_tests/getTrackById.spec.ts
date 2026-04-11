import { describe, it, expect, vi } from 'vitest';
import { type Track } from '#/modules/Arrangement/models/Track';
import { getTrackById } from '../getTrackById';
import { getTrackById as repoGetTrackById } from '../../repositories/track/getTrackById';

vi.mock('../../repositories/track/getTrackById', () => ({
    getTrackById: vi.fn(),
}));

describe('getTrackById', () => {
    it('should forward to repo and return track', () => {
        const fakeTrack = { id: 't1', name: 'A', kind: 'audio' } as unknown as Track;
        vi.mocked(repoGetTrackById).mockReturnValue(fakeTrack);

        expect(getTrackById('t1')).toBe(fakeTrack);
        expect(repoGetTrackById).toHaveBeenCalledWith('t1');
    });

    it('should forward undefined when repo has no track', () => {
        vi.mocked(repoGetTrackById).mockReturnValue(undefined);

        expect(getTrackById('missing')).toBeUndefined();
    });
});
