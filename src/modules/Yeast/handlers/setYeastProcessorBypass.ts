import { createHandler } from '#/utils/createHandler';
import { type HandlerValidationContext } from '#/utils/handlerContract';

import { setYeastProcessorBypass } from '../useCases/setYeastProcessorBypass';

import { findLiveProcessor } from './rackState';

/** The bypass state as the batch's preceding same-processor actions leave it. */
function plannedBypassed(liveBypassed: boolean, context: HandlerValidationContext, processorId: string): boolean {
    let bypassed = liveBypassed;
    for (const action of context.actions.slice(0, context.actionIndex)) {
        if (action.type === 'setYeastProcessorBypass' && action.payload.processorId === processorId) {
            bypassed = action.payload.bypassed;
        }
    }
    return bypassed;
}

export const handleSetYeastProcessorBypass = createHandler<'setYeastProcessorBypass'>({
    // Conflicts when the live bypass flag no longer matches `expectedBypassed`,
    // or the processor vanished. Per-key only: a peer edit anywhere else on the
    // rack never blocks the undo (#2111). Proven by the `canReportConflict`
    // registry honesty spec; undo step-over (#2881) relies on it.
    canReportConflict: true,
    validate: (action, context) => {
        const processor = findLiveProcessor(action.payload.processorId);
        if (!processor) {
            return false;
        }
        return (
            plannedBypassed(processor.bypassed, context, action.payload.processorId) === action.payload.expectedBypassed
        );
    },
    execute: (action) => {
        const processor = findLiveProcessor(action.payload.processorId);
        if (!processor) {
            return { status: 'conflict' };
        }
        if (processor.bypassed !== action.payload.expectedBypassed) {
            return { status: 'conflict' };
        }
        setYeastProcessorBypass(action.payload.processorId, action.payload.bypassed);
        return { status: 'written' };
    },
    isNoop: (action) => {
        const processor = findLiveProcessor(action.payload.processorId);
        return processor !== undefined && processor.bypassed === action.payload.bypassed;
    },
    describe: (action) => {
        const processor = findLiveProcessor(action.payload.processorId);
        const previousBypassed = processor?.bypassed ?? action.payload.expectedBypassed;
        return {
            label: 'Set Yeast bypass',
            inverseAction: {
                type: 'setYeastProcessorBypass',
                payload: {
                    processorId: action.payload.processorId,
                    bypassed: previousBypassed,
                    expectedBypassed: action.payload.bypassed,
                },
            },
            // Redo runs against the post-undo state, whose bypass flag is
            // exactly the pre-execution flag read here.
            redoAction: {
                type: 'setYeastProcessorBypass',
                payload: {
                    processorId: action.payload.processorId,
                    bypassed: action.payload.bypassed,
                    expectedBypassed: previousBypassed,
                },
            },
        };
    },
    undoable: true,
});
