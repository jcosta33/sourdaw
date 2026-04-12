import { describe, it, expect, vi } from 'vitest';
import { getAllTracks } from '../getAllTracks';
import { getAllTracks as repoGetAllTracks } from '../../repositories/track/getAllTracks';

vi.mock('../../repositories/track/getAllTracks', () => ({
    getAllTracks: vi.fn(),
}));

describe('getAllTracks', () => {
    it('should return tracks from repo', () => {
        const tracks = [{ id: 'a', name: 'A', kind: 'midi' }] as const;
        vi.mocked(repoGetAllTracks).mockReturnValue([...tracks] as any);

        expect(getAllTracks()).toEqual(tracks);
        expect(repoGetAllTracks).toHaveBeenCalledTimes(1);
    });
});
