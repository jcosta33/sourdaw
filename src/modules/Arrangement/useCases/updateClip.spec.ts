import { describe, it, expect, vi } from 'vitest';
import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { updateClip } from './updateClip';

describe('updateClip', () => {
    it('should forward clip id and updater to repo', () => {
        const repoUpdateClip = vi.fn();
        injectDependencies(updateClip, { repoUpdateClip });

        const updater = vi.fn((c: { id: string; name: string }) => ({ ...c, name: 'X' }));
        updateClip('c1', updater);

        expect(repoUpdateClip).toHaveBeenCalledWith('c1', updater);
    });
});
