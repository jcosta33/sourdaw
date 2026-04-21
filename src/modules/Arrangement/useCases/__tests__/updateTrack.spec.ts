import { describe, it, expect, vi } from 'vitest';

import { type Track } from '../../models/Track';
import { updateTrack as repoUpdateTrack } from '../../repositories/track/updateTrack';
import { updateTrack } from '../updateTrack';

vi.mock('../../repositories/track/updateTrack', () => ({
    updateTrack: vi.fn(),
}));

describe('updateTrack', () => {
    it('should forward track id and updater to repo', () => {
        const updater = vi.fn<(track: Track) => Track>((time) => ({ ...time, name: 'Renamed' }));
        updateTrack('t1', updater);

        expect(repoUpdateTrack).toHaveBeenCalledWith('t1', updater);
    });
});
