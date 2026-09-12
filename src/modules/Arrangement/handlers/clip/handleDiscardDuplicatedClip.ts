import { projectMidiNotesByClipIdThroughRestores } from '#/modules/MIDI/useCases';
import { createHandler } from '#/utils/createHandler';
import { type AppAction, type HandlerValidationContext } from '#/utils/handlerContract';

import { removeClip } from '../../useCases/clip/removeClip';
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
        removeClip(alpha.payload.clipId);
        return { status: 'written' };
    },
    describe: () => ({ label: 'Discard duplicated clip' }),
    undoable: false,
});
