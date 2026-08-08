import { createHandler } from '#/utils/createHandler';

import { glueClips } from '../../useCases/clipEditing/glueClips';
import { prepareClipGlue } from '../../useCases/clipEditing/prepareClipGlue';
import { restoreClipGlueState } from '../../useCases/clipEditing/restoreClipGlueState';
import { toHandlerExecutionResult } from '../toHandlerExecutionResult';

export const handleGlueClips = createHandler<'glueClips'>({
    execute: (action) => {
        if (action.payload.expected && action.payload.replacement) {
            return toHandlerExecutionResult(
                restoreClipGlueState({ expected: action.payload.expected, replacement: action.payload.replacement })
            );
        }
        return toHandlerExecutionResult(glueClips(action.payload.clipIds, action.payload.targetClipId));
    },
    describe: (action) => {
        const plan = prepareClipGlue({ clipIds: action.payload.clipIds, targetClipId: action.payload.targetClipId });
        if (!plan) {
            return { label: 'Glue clips', inverseAction: null };
        }
        action.payload.targetClipId = plan.targetClipId;
        action.payload.expected = plan.previous;
        action.payload.replacement = plan.next;
        return {
            label: 'Glue clips',
            inverseAction: {
                type: 'restoreClipGlueState',
                payload: { expected: plan.next, replacement: plan.previous },
            },
            redoAction: {
                type: 'restoreClipGlueState',
                payload: { expected: plan.previous, replacement: plan.next },
            },
        };
    },
    requiresAbortCompensation: false,
    undoable: true,
});
