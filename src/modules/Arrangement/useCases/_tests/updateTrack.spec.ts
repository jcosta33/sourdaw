import { describe, it, expect, vi } from 'vitest';
import { updateTrack } from '../updateTrack';
import { updateTrack as repoUpdateTrack } from '../../repositories/track/updateTrack';

vi.mock('../../repositories/track/updateTrack', () => ({
    updateTrack: vi.fn(),
}));

describe('updateTrack', () => {
    it('should forward track id and updater to repo', () => {
        const updater = vi.fn((t: { id: string; name: string }) => ({ ...t, name: 'Renamed' }));
        updateTrack('t1', updater as any);

        expect(repoUpdateTrack).toHaveBeenCalledWith('t1', updater);
    });
});
