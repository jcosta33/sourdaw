import { prepareTimeOperationStateRestore } from './prepareTimeOperationStateRestore';

import type { executeGlobalTimeOperation } from './executeGlobalTimeOperation';

type GlobalTimeOperationResult = ReturnType<typeof executeGlobalTimeOperation>;
type AppliedGlobalTimeOperationResult = Extract<GlobalTimeOperationResult, { status: 'applied' }>;
type ReadyTimeOperationRestore = Extract<ReturnType<typeof prepareTimeOperationStateRestore>, { status: 'ready' }>;

type CreateUndoableGlobalTimeOperationInput = {
    initialResult: AppliedGlobalTimeOperationResult;
};

function restoreOrThrow(plan: unknown): ReadyTimeOperationRestore {
    const restoration = prepareTimeOperationStateRestore(plan);
    if (restoration.status !== 'ready') {
        throw new Error('Global time operation undo conflicts with current project state');
    }
    if (!restoration.hasChanges) {
        throw new Error('Global time operation undo was not applied');
    }
    if (!restoration.apply()) {
        throw new Error('Global time operation undo was not applied');
    }
    return restoration;
}

export function createUndoableGlobalTimeOperation({ initialResult }: CreateUndoableGlobalTimeOperationInput): {
    undo: () => void;
    redo: () => void;
} {
    let redoRestoration: ReadyTimeOperationRestore | null = null;

    return {
        undo: () => {
            redoRestoration = restoreOrThrow(initialResult.inversePlan);
        },
        redo: () => {
            if (!redoRestoration?.revert()) {
                throw new Error('Global time operation redo conflicts with current project state');
            }
            redoRestoration = null;
        },
    };
}
