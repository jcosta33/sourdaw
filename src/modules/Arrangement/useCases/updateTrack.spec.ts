import { describe, it, expect, vi } from 'vitest';
import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { updateTrack } from './updateTrack';

describe('updateTrack', () => {
    it('should forward track id and updater to repo', () => {
        const repoUpdateTrack = vi.fn();
        injectDependencies(updateTrack, { repoUpdateTrack });

        const updater = vi.fn((t: { id: string; name: string }) => ({ ...t, name: 'Renamed' }));
        updateTrack('t1', updater);

        expect(repoUpdateTrack).toHaveBeenCalledWith('t1', updater);
    });
});
