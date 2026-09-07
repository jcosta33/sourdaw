import { collectTimeOperationPlanBufferIds } from './collectTimeOperationPlanBufferIds';
import { prepareTimeOperationStateRestore } from './prepareTimeOperationStateRestore';
import { reverseRestorePlan } from './reverseRestorePlan';

import type { executeGlobalTimeOperation } from './executeGlobalTimeOperation';

type GlobalTimeOperationResult = ReturnType<typeof executeGlobalTimeOperation>;
type AppliedGlobalTimeOperationResult = Extract<GlobalTimeOperationResult, { status: 'applied' }>;
type CreateUndoableGlobalTimeOperationInput = {
    initialResult: AppliedGlobalTimeOperationResult;
};

function restoreOrThrow(plan: unknown, operation: 'undo' | 'redo'): void {
    const restoration = prepareTimeOperationStateRestore(plan);
    if (restoration.status !== 'ready') {
        throw new Error(`Global time operation ${operation} conflicts with current project state`);
    }
    if (!restoration.hasChanges) {
        throw new Error(`Global time operation ${operation} was not applied`);
    }
    if (!restoration.apply()) {
        throw new Error(`Global time operation ${operation} was not applied`);
    }
}

export function createUndoableGlobalTimeOperation({ initialResult }: CreateUndoableGlobalTimeOperationInput): {
    undo: () => void;
    redo: () => void;
    /** Audio buffer ids either restore plan can bring back — declared for the
     * undo entry the caller files from this transaction. */
    restoresBufferIds: readonly string[];
} {
    const redoPlan = reverseRestorePlan(initialResult.inversePlan);
    const restoresBufferIds = [
        ...new Set([
            ...collectTimeOperationPlanBufferIds(initialResult.inversePlan),
            ...collectTimeOperationPlanBufferIds(redoPlan),
        ]),
    ];

    return {
        undo: () => restoreOrThrow(initialResult.inversePlan, 'undo'),
        redo: () => restoreOrThrow(redoPlan, 'redo'),
        restoresBufferIds,
    };
}
