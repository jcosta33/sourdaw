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
        const complete = beginProjectIdentityTransition();

        complete();
        complete();

        expect(clearActionHistory).toHaveBeenCalledTimes(1);
    });
});
