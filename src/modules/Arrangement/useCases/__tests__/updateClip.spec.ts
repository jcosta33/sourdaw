import { describe, it, expect, vi } from 'vitest';

import { updateClip as repoUpdateClip } from '../../repositories/track/updateClip';
import { updateClip } from '../updateClip';

vi.mock('../../repositories/track/updateClip', () => ({
    updateClip: vi.fn(),
}));

describe('updateClip', () => {
    it('should forward clip id and updater to repo', () => {
        const updater = vi.fn((context: { id: string; name: string }) => ({ ...context, name: 'X' }));
        updateClip('c1', updater as any);

        expect(repoUpdateClip).toHaveBeenCalledWith('c1', updater);
    });
});
