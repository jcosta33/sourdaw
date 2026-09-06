import { createHandler } from '#/utils/createHandler';

import { removeClip } from '../../useCases/clip/removeClip';
import { undoRippleInsertClip } from '../../useCases/rippleInsert/undoRippleInsertClip';

/**
 * Guarded inverse of `drawClip`: removes the drawn clip and restores any
 * neighbors the ripple insert shifted forward. Emitted only by the `drawClip`
 * handler's `describe()` — never invoked directly.
 */
export const handleDiscardDrawnClip = createHandler<'discardDrawnClip'>({
    execute: (action) => {
        removeClip(action.payload.clipId);
        const plan = action.payload.ripplePlan;
        if (plan && plan.shiftedClips.length > 0) {
            // Fresh shift objects: the snapshot is readonly, the use case's plan is not.
            undoRippleInsertClip({
                trackId: action.payload.trackId,
                plan: { shiftedClips: plan.shiftedClips.map((shift) => ({ ...shift })) },
            });
        }
        return { status: 'written' };
    },
    describe: () => ({ label: 'Discard drawn clip' }),
    undoable: false,
});
