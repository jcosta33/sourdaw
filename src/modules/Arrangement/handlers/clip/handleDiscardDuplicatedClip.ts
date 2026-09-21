import { projectMidiNotesByClipIdThroughRestores } from '#/modules/MIDI/useCases';
import { createHandler } from '#/utils/createHandler';
import { type AppAction, type HandlerValidationContext } from '#/utils/handlerContract';

import { resolveEligibleClipWriteTarget } from '../../stores/resolveEligibleClipWriteTarget';
import { removeClip } from '../../useCases/clip/removeClip';
import { captureRetiredTakeLanes } from '../../useCases/comping/captureRetiredTakeLanes';
import { restoreTakesForClip } from '../../useCases/comping/restoreTakesForClip';
import { isGeneratedMidiStateCurrent } from '../isGeneratedMidiStateCurrent';
import { projectClipThroughPriorBatchActions, type ProjectedClipState } from '../projectClipThroughPriorBatchActions';

type DiscardDuplicatedClipAction = Extract<AppAction, { type: 'discardDuplicatedClip' }>;

/**
 * #3814: a prior `restoreTrack` sibling is what brings the duplicated clip —
 * and its guarded MIDI state — back, so the guard must read the sibling's
 * projection rather than the live pre-batch state. Without a touching sibling
 * the projection is the live read, and `undefined` keeps every guard leg on
 * its existing live path.
 */
function projectedClipStateFor(
    action: DiscardDuplicatedClipAction,
    context: HandlerValidationContext
): ProjectedClipState | undefined {
    const projectedClip = projectClipThroughPriorBatchActions(action.payload.clipId, context);
    if (!projectedClip.touchedByPriorSibling) {
        return undefined;
    }
    return projectedClip;
}

export const handleDiscardDuplicatedClip = createHandler<'discardDuplicatedClip'>({
    canReapplyAfterDivergence: (action) => action.payload.generatedMidiStateGuard !== undefined,
    validate: (action, context) => {
        const guard = action.payload.generatedMidiStateGuard;
        if (!guard) {
            return true;
        }
        return isGeneratedMidiStateCurrent({
            entityId: action.payload.clipId,
            entityType: 'clip',
            guard,
            projectedMidiNotesByClipId: projectMidiNotesByClipIdThroughRestores(
                context.actions.slice(0, context.actionIndex)
            ),
            projectedClipState: projectedClipStateFor(action, context),
        });
    },
    execute: (alpha) => {
        const guard = alpha.payload.generatedMidiStateGuard;
        if (
            guard &&
            !isGeneratedMidiStateCurrent({
                entityId: alpha.payload.clipId,
                entityType: 'clip',
                guard,
            })
        ) {
            return { status: 'conflict' };
        }
        // What removing this clip is about to retire, captured before it goes. It
        // goes on this inverse's own payload because the paired redo re-creates the
        // same clip id off the entry, and the entry is what survives the session
        // mirror — a second array shared with that redo's payload would not.
        alpha.payload.retiredTakeLanes = captureRetiredTakeLanes([alpha.payload.clipId]);
        removeClip(alpha.payload.clipId);
        return { status: 'written' };
    },
    describe: () => ({ label: 'Discard duplicated clip' }),
    /**
     * The entry's redo re-created the clip this discard removed, so put back the
     * takes the discard captured. A redo that re-created nothing — a no-op replay,
     * or a route that mints a fresh id instead of reusing the captured one — leaves
     * the named clip absent, and re-attaching a lane to a clip identity nothing
     * carries would leave the takes orphaned rather than restored.
     */
    afterRedoReplay: (action) => {
        if (resolveEligibleClipWriteTarget({ clipId: action.payload.clipId }).status === 'missing') {
            return;
        }
        restoreTakesForClip(action.payload.retiredTakeLanes ?? []);
    },
    undoable: false,
});
