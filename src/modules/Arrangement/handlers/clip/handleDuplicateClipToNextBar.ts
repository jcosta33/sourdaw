import { createHandler } from '#/utils/createHandler';

import { resolveEligibleClipWriteTarget } from '../../stores/resolveEligibleClipWriteTarget';
import { duplicateClipToNextBar } from '../../useCases/clip/duplicateClipToNextBar';
import { prepareDuplicateClipTargetId } from '../../useCases/clip/prepareDuplicateClipTargetId';
import { toHandlerExecutionResult } from '../toHandlerExecutionResult';

type DuplicateClipToNextBarAction = { payload: { clipId: string; targetClipId?: string } };

function ensureTargetClipId(action: DuplicateClipToNextBarAction): string {
    if (action.payload.targetClipId) {
        return action.payload.targetClipId;
    }
    const targetClipId = prepareDuplicateClipTargetId();
    action.payload.targetClipId = targetClipId;
    return targetClipId;
}

function isDuplicateClipToNextBarNoop(action: DuplicateClipToNextBarAction): boolean {
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

export const handleDuplicateClipToNextBar = createHandler<'duplicateClipToNextBar'>({
    materializeCommandArguments: (action) => {
        ensureTargetClipId(action);
    },
    execute: (alpha) => {
        return toHandlerExecutionResult(
            duplicateClipToNextBar({
                clipId: alpha.payload.clipId,
                targetClipId: ensureTargetClipId(alpha),
            })
        );
    },
    describe: (alpha) => ({
        label: 'Duplicate clip to next bar',
        inverseAction: { type: 'discardDuplicatedClip', payload: { clipId: ensureTargetClipId(alpha) } },
    }),
    isNoop: isDuplicateClipToNextBarNoop,
    undoable: true,
});
