import { createHandler } from '#/utils/createHandler';

import { addClip } from '../../useCases/clip/addClip';
import { getNextAppActionClipId } from '../../useCases/clip/getNextAppActionClipId';
import { toHandlerExecutionResult } from '../toHandlerExecutionResult';

type AddClipAction = { payload: { id?: string } };

const clipIdsByAction = new WeakMap<object, string>();

function getClipId(action: AddClipAction): string {
    if (action.payload.id) {
        return action.payload.id;
    }
    const existingClipId = clipIdsByAction.get(action);
    if (existingClipId) {
        return existingClipId;
    }
    const clipId = getNextAppActionClipId();
    clipIdsByAction.set(action, clipId);
    return clipId;
}

export const handleAddClip = createHandler<'addClip'>({
    execute: (alpha) => {
        const clipId = getClipId(alpha);
        return toHandlerExecutionResult(addClip({ ...alpha.payload, id: clipId }) !== null);
    },
    describe: (alpha) => {
        const clipId = getClipId(alpha);
        return {
            label: `Add clip "${alpha.payload.name}"`,
            inverseAction: { type: 'discardDuplicatedClip', payload: { clipId } },
            redoAction: { type: 'addClip', payload: { ...alpha.payload, id: clipId } },
        };
    },
    undoable: true,
    requiresAbortCompensation: false,
});
