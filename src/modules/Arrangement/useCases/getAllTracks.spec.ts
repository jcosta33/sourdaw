import { describe, it, expect, vi } from 'vitest';
import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { getAllTracks } from './getAllTracks';

describe('getAllTracks', () => {
    it('should return tracks from repo', () => {
        const tracks = [{ id: 'a', name: 'A', kind: 'midi' }] as const;
        const repoGetAllTracks = vi.fn(() => [...tracks]);
        injectDependencies(getAllTracks, { repoGetAllTracks });

        expect(getAllTracks()).toEqual(tracks);
        expect(repoGetAllTracks).toHaveBeenCalledTimes(1);
    });
});
