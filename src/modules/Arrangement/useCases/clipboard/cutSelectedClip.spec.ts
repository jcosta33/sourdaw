import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Container } from '#/infra/di/Container';
import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { cutSelectedClip } from './cutSelectedClip';

describe('cutSelectedClip', () => {
    beforeEach(() => {
        Container.clear();
    });

    it('returns early when workspace is unavailable without calling removeClip', () => {
        const getWorkspaceState = vi.fn().mockReturnValue(null);
        const removeClip = vi.fn();
        injectDependencies(cutSelectedClip, { getWorkspaceState, removeClip });

        cutSelectedClip();

        expect(removeClip).not.toHaveBeenCalled();
    });
});
