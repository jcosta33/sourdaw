import { describe, it, expect, vi } from 'vitest';
import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { type Track } from '#/modules/Arrangement/models/Track';
import { getTrackById } from './getTrackById';

describe('getTrackById', () => {
    it('should forward to repo and return track', () => {
        const fakeTrack = { id: 't1', name: 'A', kind: 'audio' } as unknown as Track;
        const repoGetTrackById = vi.fn(() => fakeTrack);
        injectDependencies(getTrackById, { repoGetTrackById });

        expect(getTrackById('t1')).toBe(fakeTrack);
        expect(repoGetTrackById).toHaveBeenCalledWith('t1');
    });

    it('should forward undefined when repo has no track', () => {
        const repoGetTrackById = vi.fn(() => undefined);
        injectDependencies(getTrackById, { repoGetTrackById });

        expect(getTrackById('missing')).toBeUndefined();
    });
});
