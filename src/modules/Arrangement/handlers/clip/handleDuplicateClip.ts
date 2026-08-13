import { createHandler } from '#/utils/createHandler';

import { resolveEligibleClipWriteTarget } from '../../stores/resolveEligibleClipWriteTarget';
import { duplicateClip } from '../../useCases/clip/duplicateClip';
import { prepareDuplicateClipTargetId } from '../../useCases/clip/prepareDuplicateClipTargetId';
import { toHandlerExecutionResult } from '../toHandlerExecutionResult';

type DuplicateClipAction = { payload: { clipId: string; targetClipId?: string } };

function ensureTargetClipId(action: DuplicateClipAction): string {
    if (action.payload.targetClipId) {
        return action.payload.targetClipId;
    }
    const targetClipId = prepareDuplicateClipTargetId();
    action.payload.targetClipId = targetClipId;
    return targetClipId;
}

function isDuplicateClipNoop(action: DuplicateClipAction): boolean {
    const sourceTarget = resolveEligibleClipWriteTarget({ clipId: action.payload.clipId });
    if (sourceTarget.status !== 'eligible' || !('clipId' in sourceTarget)) {
        return true;
    }

    const destinationTarget = resolveEligibleClipWriteTarget({ trackId: sourceTarget.trackId });
    if (destinationTarget.status !== 'eligible') {
        return true;
    }

    const targetClipId = action.payload.targetClipId;
    if (targetClipId === undefined) {
        return false;
    }
    if (targetClipId.length === 0) {
        return true;
    }

    return resolveEligibleClipWriteTarget({ clipId: targetClipId }).status !== 'missing';
}

export const handleDuplicateClip = createHandler<'duplicateClip'>({
    materializeCommandArguments: (action) => {
        ensureTargetClipId(action);
    },
    execute: (alpha) => {
        return toHandlerExecutionResult(
            duplicateClip({
                clipId: alpha.payload.clipId,
                targetClipId: ensureTargetClipId(alpha),
            })
        );
    },
    describe: (alpha) => ({
        label: 'Duplicate clip',
        inverseAction: { type: 'discardDuplicatedClip', payload: { clipId: ensureTargetClipId(alpha) } },
    }),
    isNoop: isDuplicateClipNoop,
    undoable: true,
});
