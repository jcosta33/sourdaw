import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleAutoOrganizeProject } from '../handleAutoOrganizeProject';

vi.mock('#/modules/Arrangement/useCases', () => ({
    getTrackStoreState: vi.fn(),
    renameTrack: vi.fn(),
    setTrackColor: vi.fn(),
    groupTracks: vi.fn(),
}));

import {
    getTrackStoreState,
    renameTrack,
    setTrackColor,
    groupTracks,
} from '#/modules/Arrangement/useCases';

describe('handleAutoOrganizeProject', () => {
    beforeEach(() => {
        vi.mocked(getTrackStoreState).mockReset();
        vi.mocked(renameTrack).mockReset();
        vi.mocked(setTrackColor).mockReset();
        vi.mocked(groupTracks).mockReset();
    });

    it('no-ops when track state is missing', async () => {
        vi.mocked(getTrackStoreState).mockReturnValue(null);

        await handleAutoOrganizeProject.execute({
            type: 'autoOrganizeProject',
            payload: { tracks: [{ trackId: 't1', newName: 'A' }] },
        });

        expect(renameTrack).not.toHaveBeenCalled();
    });
});
