import { beforeEach, describe, it, expect, vi } from 'vitest';

import { type Clip } from '../../models/Track';
import { updateClip as repoUpdateClip } from '../../repositories/track/updateClip';
import { updateClip } from '../updateClip';

const mocks = vi.hoisted(() => ({
    resolveEligibleClipWriteTarget: vi.fn(),
}));

vi.mock('../../repositories/track/updateClip', () => ({
    updateClip: vi.fn(),
}));

vi.mock('../../stores/resolveEligibleClipWriteTarget', () => ({
    resolveEligibleClipWriteTarget: mocks.resolveEligibleClipWriteTarget,
}));

describe('updateClip', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.resolveEligibleClipWriteTarget.mockReturnValue({
            status: 'eligible',
            trackId: 't1',
            clipId: 'c1',
        });
        vi.mocked(repoUpdateClip).mockImplementation(() => true);
    });

    it('should forward clip id and updater to repo', () => {
        const updater = vi.fn<(clip: Clip) => Clip>((context) => ({ ...context, name: 'X' }));
        const didWrite = updateClip('c1', updater);

        expect(didWrite).toBe(true);
        expect(repoUpdateClip).toHaveBeenCalledWith('c1', updater);
    });

    it('rejects dormant VCA clip updates before the repository write', () => {
        mocks.resolveEligibleClipWriteTarget.mockReturnValue({ status: 'ineligible' });
        const updater = vi.fn<(clip: Clip) => Clip>((clip) => clip);

        const didWrite = updateClip('c1', updater);

        expect(didWrite).toBe(false);
        expect(repoUpdateClip).not.toHaveBeenCalled();
        expect(updater).not.toHaveBeenCalled();
    });
});
