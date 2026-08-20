import { createHandler } from '#/utils/createHandler';

import { removeClip } from '../../useCases/clip/removeClip';
import { isGeneratedMidiStateCurrent } from '../isGeneratedMidiStateCurrent';

export const handleDiscardDuplicatedClip = createHandler<'discardDuplicatedClip'>({
    canReapplyAfterDivergence: (action) => action.payload.generatedMidiStateGuard !== undefined,
    validate: (action) => {
        const guard = action.payload.generatedMidiStateGuard;
        if (!guard) {
            return true;
        }
        return isGeneratedMidiStateCurrent({
            entityId: action.payload.clipId,
            entityType: 'clip',
            guard,
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
