import { createHandler } from '#/utils/createHandler';
import { type HandlerValidationContext } from '#/utils/handlerContract';

import { type ArpStep, decodeArpPatternParams } from '../models/ArpPattern';
import { setYeastArpPattern } from '../useCases/setYeastArpPattern';

import { findLiveProcessor, isSameSnapshot } from './rackState';

/** The pattern as the batch's preceding same-processor actions leave it. A
 *  paint stroke replays its inverses as one batch, so a guard must read the
 *  sequentially projected pattern, not the live pre-batch one. */
function plannedSteps(
    liveSteps: readonly ArpStep[],
    context: HandlerValidationContext,
    processorId: string
): readonly ArpStep[] {
    let steps: readonly ArpStep[] = liveSteps;
    for (const action of context.actions.slice(0, context.actionIndex)) {
        if (action.type === 'setYeastArpPattern' && action.payload.processorId === processorId) {
            steps = action.payload.steps;
        }
    }
    return steps;
}

export const handleSetYeastArpPattern = createHandler<'setYeastArpPattern'>({
    // Conflicts when the live DECODED pattern no longer matches `expectedSteps`,
    // or the processor vanished or is not an arpeggiator. The guard compares
    // only the `pattern_*` subset, so a peer editing another parameter of the
    // same processor never blocks the undo (#2111). Proven by the
    // `canReportConflict` registry honesty spec; undo step-over (#2881) relies
    // on it.
    canReportConflict: true,
    validate: (action, context) => {
        const processor = findLiveProcessor(action.payload.processorId);
        if (processor?.type !== 'arpeggiator') {
            return false;
        }
        const { expectedSteps } = action.payload;
        if (expectedSteps === undefined) {
            return true;
        }
        return isSameSnapshot(
            plannedSteps(decodeArpPatternParams(processor.params), context, action.payload.processorId),
            expectedSteps
        );
    },
    execute: async (action) => {
        const processor = findLiveProcessor(action.payload.processorId);
        if (processor?.type !== 'arpeggiator') {
            return { status: 'conflict' };
        }
        const { expectedSteps } = action.payload;
        if (expectedSteps !== undefined && !isSameSnapshot(decodeArpPatternParams(processor.params), expectedSteps)) {
            return { status: 'conflict' };
        }
        // The use case writes the store before its first await, so the write
        // lands inside the dispatch's storage transaction; the awaited tail
        // only pushes the runtime projection to the worker.
        await setYeastArpPattern(action.payload.processorId, action.payload.steps);
        return { status: 'written' };
    },
    isNoop: (action) => {
        const processor = findLiveProcessor(action.payload.processorId);
        if (processor?.type !== 'arpeggiator') {
            return false;
        }
        return isSameSnapshot(decodeArpPatternParams(processor.params), action.payload.steps);
    },
    describe: (action) => {
        const processor = findLiveProcessor(action.payload.processorId);
        const previousSteps = processor ? decodeArpPatternParams(processor.params) : [];
        return {
            label: 'Set arp pattern',
            inverseAction: isSameSnapshot(previousSteps, action.payload.steps)
                ? null
                : {
                      type: 'setYeastArpPattern',
                      payload: {
                          processorId: action.payload.processorId,
                          steps: previousSteps,
                          expectedSteps: action.payload.steps,
                      },
                  },
            // Redo runs against the post-undo state, whose pattern is exactly
            // the pre-execution pattern read here.
            redoAction: {
                type: 'setYeastArpPattern',
                payload: {
                    processorId: action.payload.processorId,
                    steps: action.payload.steps,
                    expectedSteps: previousSteps,
                },
            },
        };
    },
    undoable: true,
});
