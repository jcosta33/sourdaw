import { createHandler } from '#/utils/createHandler';
import { type AppAction } from '#/utils/handlerContract';

import { prepareStripSilence } from '../../useCases/prepareStripSilence';
import { restoreStripSilenceState } from '../../useCases/restoreStripSilenceState';
import { stripSilence } from '../../useCases/stripSilence';
import { toHandlerExecutionResult } from '../toHandlerExecutionResult';

type StripSilenceAction = Extract<AppAction, { type: 'stripSilence' }>;

function prepareAction(action: StripSilenceAction) {
    delete action.payload.expected;
    delete action.payload.replacement;
    return prepareStripSilence({
        clipId: action.payload.clipId,
        threshold: action.payload.threshold,
        minDuration: action.payload.minDuration,
    });
}

export const handleStripSilence = createHandler<'stripSilence'>({
    materializeCommandArguments: (action) => {
        const plan = prepareAction(action);
        if (!plan) {
            return;
        }
        action.payload.expected = plan.previous;
        action.payload.replacement = plan.next;
    },
    execute: (action) => {
        if (action.payload.expected && action.payload.replacement) {
            return toHandlerExecutionResult(
                restoreStripSilenceState({
                    expected: action.payload.expected,
                    replacement: action.payload.replacement,
                })
            );
        }
        return toHandlerExecutionResult(
            stripSilence(action.payload.clipId, action.payload.threshold, action.payload.minDuration)
        );
    },
    describe: (action) => {
        const plan = prepareAction(action);
        if (!plan) {
            return { label: 'Strip silence', inverseAction: null };
        }
        action.payload.expected = plan.previous;
        action.payload.replacement = plan.next;
        return {
            label: 'Strip silence',
            inverseAction: {
                type: 'restoreStripSilenceState',
                payload: { expected: plan.next, replacement: plan.previous },
            },
            redoAction: {
                type: 'restoreStripSilenceState',
                payload: { expected: plan.previous, replacement: plan.next },
            },
        };
    },
    previewExecution: 'isolated-project',
    requiresAbortCompensation: false,
    undoable: true,
});
