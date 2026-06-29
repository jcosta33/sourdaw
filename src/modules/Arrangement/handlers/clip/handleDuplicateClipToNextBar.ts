import { createHandler } from '#/utils/createHandler';

import { duplicateClipToNextBar } from '../../useCases/clip/duplicateClipToNextBar';
import { prepareDuplicateClipTargetId } from '../../useCases/clip/prepareDuplicateClipTargetId';

type DuplicateClipToNextBarAction = { payload: { clipId: string; targetClipId?: string } };

function ensureTargetClipId(action: DuplicateClipToNextBarAction): string {
    if (action.payload.targetClipId) {
        return action.payload.targetClipId;
    }
    const targetClipId = prepareDuplicateClipTargetId();
    action.payload.targetClipId = targetClipId;
    return targetClipId;
}

export const handleDuplicateClipToNextBar = createHandler<'duplicateClipToNextBar'>({
    execute: (alpha) => {
        duplicateClipToNextBar({
            clipId: alpha.payload.clipId,
            targetClipId: ensureTargetClipId(alpha),
        });
    },
    describe: (alpha) => ({
        label: 'Duplicate clip to next bar',
        inverseAction: { type: 'discardDuplicatedClip', payload: { clipId: ensureTargetClipId(alpha) } },
    }),
    undoable: true,
});
