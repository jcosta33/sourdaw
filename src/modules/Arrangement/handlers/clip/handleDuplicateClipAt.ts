import { createHandler } from '#/utils/createHandler';
import { type AppAction, type HandlerValidationContext } from '#/utils/handlerContract';

import { resolveEligibleClipWriteTarget } from '../../stores/resolveEligibleClipWriteTarget';
import { duplicateClipCore } from '../../useCases/clip/duplicateClipCore';
import { prepareDuplicateClipTargetId } from '../../useCases/clip/prepareDuplicateClipTargetId';
import { toHandlerExecutionResult } from '../toHandlerExecutionResult';

type DuplicateClipAtAction = Extract<AppAction, { type: 'duplicateClipAt' }>;

type DuplicateClipAtState = { targetClipId: string };

const duplicateClipAtStates = new WeakMap<object, DuplicateClipAtState>();

function ensureTargetClipId(action: DuplicateClipAtAction): string {
    if (action.payload.targetClipId) {
        return action.payload.targetClipId;
    }
    const targetClipId = prepareDuplicateClipTargetId();
    action.payload.targetClipId = targetClipId;
    return targetClipId;
}

function getDuplicateClipAtState(action: DuplicateClipAtAction): DuplicateClipAtState {
    const existing = duplicateClipAtStates.get(action);
    if (existing) {
        return existing;
    }
    const state = { targetClipId: ensureTargetClipId(action) };
    duplicateClipAtStates.set(action, state);
    return state;
}

/**
 * Batch members of this handler must be mutually independent: each member reads
 * its source clip and its destination track and writes only its own fresh copy
 * id, so a member whose source another member removes, whose destination track
 * another member removes or restores, or whose copy id another member claims
 * would preflight against state its siblings rewrite — wedging the grouped
 * undo that replays the batch. Same-target collisions are checked explicitly
 * because two members claiming one copy id would otherwise both "create" it.
 */
function batchMembersAreIndependent(action: DuplicateClipAtAction, context: HandlerValidationContext): boolean {
    const otherMembers = context.actions.filter((_, index) => index !== context.actionIndex);
    if (otherMembers.length === 0) {
        return true;
    }
    const claimsSameCopyId = otherMembers.some(
        (member) => member.type === 'duplicateClipAt' && member.payload.targetClipId === action.payload.targetClipId
    );
    if (claimsSameCopyId) {
        return false;
    }
    return !otherMembers.some(
        (member) =>
            ((member.type === 'removeClip' || member.type === 'restoreClip') &&
                member.payload.clipId === action.payload.clipId) ||
            ((member.type === 'removeTrack' || member.type === 'restoreTrack') &&
                member.payload.trackId === action.payload.destinationTrackId)
    );
}

export const handleDuplicateClipAt = createHandler<'duplicateClipAt'>({
    // Batch co-execution (grouped per-clip duplicate dispatches, grouped redo)
    // preflights the state the action assumes — source present and eligible,
    // destination track eligible, copy id still fresh — and refuses the whole
    // batch on a hazard. Single-action dispatch never calls validate.
    validate: (action, context) => {
        const sourceTarget = resolveEligibleClipWriteTarget({ clipId: action.payload.clipId });
        if (sourceTarget.status !== 'eligible' || !('clipId' in sourceTarget)) {
            return false;
        }
        if (resolveEligibleClipWriteTarget({ trackId: action.payload.destinationTrackId }).status !== 'eligible') {
            return false;
        }
        if (
            resolveEligibleClipWriteTarget({ clipId: getDuplicateClipAtState(action).targetClipId }).status !==
            'missing'
        ) {
            return false;
        }
        return batchMembersAreIndependent(action, context);
    },
    materializeCommandArguments: (action) => {
        ensureTargetClipId(action);
    },
    execute: (action) => {
        const state = getDuplicateClipAtState(action);
        const created = duplicateClipCore({
            clipId: action.payload.clipId,
            targetClipId: state.targetClipId,
            destinationTrackId: action.payload.destinationTrackId,
            computeStartBeat: () => action.payload.startBeat,
        });
        return toHandlerExecutionResult(created);
    },
    describe: (action) => {
        const state = getDuplicateClipAtState(action);
        return {
            label: 'Duplicate clip at destination',
            inverseAction: {
                type: 'discardDuplicatedClip',
                payload: { clipId: state.targetClipId },
            },
        };
    },
    undoable: true,
    previewExecution: 'isolated-project',
    requiresAbortCompensation: false,
});
