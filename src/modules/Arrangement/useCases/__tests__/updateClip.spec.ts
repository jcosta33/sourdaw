import { beforeEach, describe, it, expect, vi } from 'vitest';

import { type Clip } from '../../models/Track';
import { updateClip as repoUpdateClip } from '../../repositories/track/updateClip';
import { updateClip } from '../updateClip';

const mocks = vi.hoisted(() => ({
    getTrackState: vi.fn(),
}));

vi.mock('../../repositories/track/updateClip', () => ({
    updateClip: vi.fn(),
}));

vi.mock('../../repositories/track/getTrackState', () => ({
    getTrackState: mocks.getTrackState,
}));

describe('updateClip', () => {
    beforeEach(() => vi.clearAllMocks());

    it('should forward clip id and updater to repo', () => {
        mocks.getTrackState.mockReturnValue({ tracks: [{ id: 't1', kind: 'audio', clips: [{ id: 'c1' }] }] });
        const updater = vi.fn<(clip: Clip) => Clip>((context) => ({ ...context, name: 'X' }));
        updateClip('c1', updater);

        expect(repoUpdateClip).toHaveBeenCalledWith('c1', updater);
    });

    it('rejects dormant VCA clip updates before the repository write', () => {
        mocks.getTrackState.mockReturnValue({ tracks: [{ id: 'vca-1', kind: 'vca', clips: [{ id: 'c1' }] }] });
        const updater = vi.fn<(clip: Clip) => Clip>((clip) => clip);

        updateClip('c1', updater);

        expect(repoUpdateClip).not.toHaveBeenCalled();
        expect(updater).not.toHaveBeenCalled();
    });
});
