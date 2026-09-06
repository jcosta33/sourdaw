import { createHandler } from '#/utils/createHandler';
import { type ClipRippleInsertPlanSnapshot } from '#/utils/handlerContract';

import { addClip } from '../../useCases/clip/addClip';
import { rippleInsertClip } from '../../useCases/rippleInsert/rippleInsertClip';
import { toHandlerExecutionResult } from '../toHandlerExecutionResult';

/**
 * Redo half of `drawClip`: re-creates the drawn clip and re-applies the ripple
 * plan captured at draw time. Emitted only by the `drawClip` handler's
 * `describe()` — never invoked directly. The plan is replayed verbatim so redo
 * restores exactly the forward placement regardless of the current ripple
 * preference; replaying the forward draw would re-plan against live state and
 * either miss the recorded shifts or shift clips the gesture never touched.
 */
export const handleRestoreDrawnClip = createHandler<'restoreDrawnClip'>({
    execute: (action) => {
        const clip = addClip({
            id: action.payload.clipId,
            trackId: action.payload.trackId,
            startBeat: action.payload.startBeat,
            endBeat: action.payload.endBeat,
            name: action.payload.name,
            type: action.payload.type,
        });
        if (!clip) {
            return toHandlerExecutionResult(false);
        }
        const plan: ClipRippleInsertPlanSnapshot | null = action.payload.ripplePlan;
        if (plan && plan.shiftedClips.length > 0) {
            // Fresh shift objects: the snapshot is readonly, the use case's plan is not.
            rippleInsertClip({
                trackId: action.payload.trackId,
                insertDuration: action.payload.endBeat - action.payload.startBeat,
                plan: { shiftedClips: plan.shiftedClips.map((shift) => ({ ...shift })) },
            });
        }
        return toHandlerExecutionResult(true);
    },
    describe: () => ({ label: 'Restore drawn clip' }),
    undoable: false,
});
