import { createHandler } from '#/utils/createHandler';

import { duplicateClip } from '../../useCases/clip/duplicateClip';
import { prepareDuplicateClipTargetId } from '../../useCases/clip/prepareDuplicateClipTargetId';

type DuplicateClipAction = { payload: { clipId: string; targetClipId?: string } };

function ensureTargetClipId(action: DuplicateClipAction): string {
    if (action.payload.targetClipId) {
        return action.payload.targetClipId;
    }
    const targetClipId = prepareDuplicateClipTargetId();
    action.payload.targetClipId = targetClipId;
    return targetClipId;
}

export const handleDuplicateClip = createHandler<'duplicateClip'>({
    execute: (alpha) => {
        duplicateClip({
            clipId: alpha.payload.clipId,
            targetClipId: ensureTargetClipId(alpha),
        });
    },
    describe: (alpha) => ({
        label: 'Duplicate clip',
        inverseAction: { type: 'discardDuplicatedClip', payload: { clipId: ensureTargetClipId(alpha) } },
    }),
    undoable: true,
});
