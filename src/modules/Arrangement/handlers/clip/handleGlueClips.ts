import { createHandler } from '#/utils/createHandler';
import { type AppAction } from '#/utils/handlerContract';

import { glueClips } from '../../useCases/clipEditing/glueClips';
import { prepareClipGlue } from '../../useCases/clipEditing/prepareClipGlue';
import { restoreClipGlueState } from '../../useCases/clipEditing/restoreClipGlueState';
import { toHandlerExecutionResult } from '../toHandlerExecutionResult';

type GlueClipsAction = Extract<AppAction, { type: 'glueClips' }>;

function prepareAction(action: GlueClipsAction) {
    delete action.payload.targetClipId;
    delete action.payload.expected;
    delete action.payload.replacement;
    const plan = prepareClipGlue({ clipIds: action.payload.clipIds });
    if (!plan) {
        return null;
    }
    action.payload.targetClipId = plan.targetClipId;
    action.payload.expected = plan.previous;
    action.payload.replacement = plan.next;
    return plan;
}

export const handleGlueClips = createHandler<'glueClips'>({
    materializeCommandArguments: (action) => {
        prepareAction(action);
    },
    execute: (action) => {
        if (action.payload.expected && action.payload.replacement) {
            return toHandlerExecutionResult(
                restoreClipGlueState({ expected: action.payload.expected, replacement: action.payload.replacement })
            );
        }
        return toHandlerExecutionResult(glueClips(action.payload.clipIds, action.payload.targetClipId));
    },
    describe: (action) => {
        const plan = prepareAction(action);
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
    previewExecution: 'isolated-project',
    requiresAbortCompensation: false,
    undoable: true,
});
