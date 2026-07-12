import { beforeEach, describe, expect, it, vi } from 'vitest';

import { resetActionReplayAuthority } from '#/modules/Command/useCases';

import { beginProjectIdentityTransition } from '../beginProjectIdentityTransition';
import { setProjectIdentityTransitionDependencies } from '../projectIdentityTransitionDependencies';

vi.mock('#/modules/Command/useCases', () => ({
    resetActionReplayAuthority: vi.fn(),
}));

describe('beginProjectIdentityTransition', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        setProjectIdentityTransitionDependencies({ leaveCollaborationSession: async () => undefined });
    });

    it('should revoke runtime authority at start without clearing source-project metadata', () => {
        beginProjectIdentityTransition();

        expect(resetActionReplayAuthority).toHaveBeenCalledTimes(1);
    });

    it('should complete identity ownership only after collaboration shutdown', async () => {
        const transition = beginProjectIdentityTransition();

        expect(transition.complete()).toBe(false);
        await expect(transition.prepare()).resolves.toBe(true);
        expect(transition.complete()).toBe(true);
        expect(transition.complete()).toBe(false);
    });

    it('should make an older transition stale as soon as a newer transition begins', async () => {
        const first = beginProjectIdentityTransition();
        const second = beginProjectIdentityTransition();

        expect(first.isCurrent()).toBe(false);
        await expect(first.prepare()).resolves.toBe(false);
        expect(first.complete()).toBe(false);
        expect(second.isCurrent()).toBe(true);
        await expect(second.prepare()).resolves.toBe(true);
        expect(second.complete()).toBe(true);
    });

    it('should reject preparation and prevent completion when collaboration shutdown fails', async () => {
        const failure = new Error('peer shutdown failed');
        setProjectIdentityTransitionDependencies({
            leaveCollaborationSession: async () => {
                throw failure;
            },
        });
        const transition = beginProjectIdentityTransition();

        await expect(transition.prepare()).rejects.toBe(failure);
        expect(transition.complete()).toBe(false);
    });
});
