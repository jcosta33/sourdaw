import { describe, it, expect, vi } from 'vitest';

import { type Clip } from '../../models/Track';
import { updateClip as repoUpdateClip } from '../../repositories/track/updateClip';
import { updateClip } from '../updateClip';

vi.mock('../../repositories/track/updateClip', () => ({
    updateClip: vi.fn(),
}));

describe('updateClip', () => {
    it('should forward clip id and updater to repo', () => {
        const updater = vi.fn<(clip: Clip) => Clip>((context) => ({ ...context, name: 'X' }));
        updateClip('c1', updater);

        expect(repoUpdateClip).toHaveBeenCalledWith('c1', updater);
    });
});
