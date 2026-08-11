import { prepareTimeOperationStateRestore } from './prepareTimeOperationStateRestore';

import type { executeGlobalTimeOperation } from './executeGlobalTimeOperation';

type GlobalTimeOperationResult = ReturnType<typeof executeGlobalTimeOperation>;
type AppliedGlobalTimeOperationResult = Extract<GlobalTimeOperationResult, { status: 'applied' }>;

type CreateUndoableGlobalTimeOperationInput = {
    initialResult: AppliedGlobalTimeOperationResult;
    replay: () => GlobalTimeOperationResult;
};

function restoreOrThrow(plan: unknown): void {
    const restoration = prepareTimeOperationStateRestore(plan);
    if (restoration.status !== 'ready') {
        throw new Error('Global time operation undo conflicts with current project state');
    }
    if (!restoration.hasChanges) {
        return;
    }
    if (!restoration.apply()) {
        throw new Error('Global time operation undo was not applied');
    }
}

export function createUndoableGlobalTimeOperation({ initialResult, replay }: CreateUndoableGlobalTimeOperationInput): {
    undo: () => void;
    redo: () => void;
} {
    let inversePlan = initialResult.inversePlan;

    return {
        undo: () => restoreOrThrow(inversePlan),
        redo: () => {
            const replayResult = replay();
            if (replayResult.status !== 'applied') {
                throw new Error('Global time operation redo conflicts with current project state');
            }
            inversePlan = replayResult.inversePlan;
        },
    };
}
