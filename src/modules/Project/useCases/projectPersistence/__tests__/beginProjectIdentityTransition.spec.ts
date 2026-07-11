import { beforeEach, describe, expect, it, vi } from 'vitest';

import { clearActionHistory, resetActionReplayAuthority } from '#/modules/Command/useCases';

import { beginProjectIdentityTransition } from '../beginProjectIdentityTransition';

vi.mock('#/modules/Command/useCases', () => ({
    clearActionHistory: vi.fn(),
    resetActionReplayAuthority: vi.fn(),
}));

describe('beginProjectIdentityTransition', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should revoke runtime authority at start without clearing source-project metadata', () => {
        beginProjectIdentityTransition();

        expect(resetActionReplayAuthority).toHaveBeenCalledTimes(1);
        expect(clearActionHistory).not.toHaveBeenCalled();
    });

    it('should scrub target metadata only when the transition completes', () => {
        const transition = beginProjectIdentityTransition();

        expect(transition.complete()).toBe(true);
        expect(transition.complete()).toBe(false);

        expect(clearActionHistory).toHaveBeenCalledTimes(1);
    });

    it('should make an older transition stale as soon as a newer transition begins', () => {
        const first = beginProjectIdentityTransition();
        const second = beginProjectIdentityTransition();

        expect(first.isCurrent()).toBe(false);
        expect(first.complete()).toBe(false);
        expect(second.isCurrent()).toBe(true);
        expect(second.complete()).toBe(true);
        expect(clearActionHistory).toHaveBeenCalledTimes(1);
    });
});
