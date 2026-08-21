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
} {
    const redoPlan = reverseRestorePlan(initialResult.inversePlan);

    return {
        undo: () => restoreOrThrow(initialResult.inversePlan, 'undo'),
        redo: () => restoreOrThrow(redoPlan, 'redo'),
    };
}
