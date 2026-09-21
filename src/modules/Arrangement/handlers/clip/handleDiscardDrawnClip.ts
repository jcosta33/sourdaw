import { createHandler } from '#/utils/createHandler';

import { removeClip } from '../../useCases/clip/removeClip';
import { captureRetiredTakeLanes } from '../../useCases/comping/captureRetiredTakeLanes';
import { undoRippleInsertClip } from '../../useCases/rippleInsert/undoRippleInsertClip';

/**
 * Guarded inverse of `drawClip`: removes the drawn clip and restores any
 * neighbors the ripple insert shifted forward. Emitted only by the `drawClip`
 * handler's `describe()` — never invoked directly.
 */
export const handleDiscardDrawnClip = createHandler<'discardDrawnClip'>({
    execute: (action) => {
        const retiredTakeLanes = action.payload.retiredTakeLanes;
        if (retiredTakeLanes) {
            // Capture what removing the drawn clip is about to retire, in place, so
            // the paired redo — which re-adds the same clip id — can put back a take
            // that landed on it after the draw.
            retiredTakeLanes.splice(0, retiredTakeLanes.length, ...captureRetiredTakeLanes([action.payload.clipId]));
        }
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
