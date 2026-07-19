import { commandMutationRuntime } from './commandMutationRuntime';

/**
 * Command operations read domain/history state, may await handler work, then
 * commit linear and tree history. One FIFO chain prevents another action,
 * undo, redo, or group reversion from publishing against a stale snapshot.
 * Internal replay uses `executeAppActionImpl` so it remains inside the owning
 * operation instead of reacquiring this lock.
 */
type PendingMutation = {
    operation: () => unknown;
    resolve: (value: unknown) => void;
    reject: (error: unknown) => void;
};

const pending_mutations: PendingMutation[] = [];

function startMutation({ operation, resolve, reject }: PendingMutation): void {
    commandMutationRuntime.mutationActive = true;
    let result: unknown;
    try {
        // Start synchronously. Legacy UI mutations historically publish in the
        // initiating turn when no older Command owner is active.
        commandMutationRuntime.synchronousOwnerDepth += 1;
        try {
            result = operation();
        } finally {
            commandMutationRuntime.synchronousOwnerDepth -= 1;
        }
    } catch (error) {
        reject(error);
        finishMutation();
        return;
    }

    void Promise.resolve(result).then(resolve, reject).finally(finishMutation);
}

function finishMutation(): void {
    const next = pending_mutations.shift();
    if (!next) {
        commandMutationRuntime.mutationActive = false;
        return;
    }
    startMutation(next);
}

export function runCommandMutationExclusive<Output>(operation: () => Promise<Output> | Output): Promise<Output> {
    return new Promise<Output>((resolve, reject) => {
        const pending: PendingMutation = {
            operation,
            resolve: (value) => resolve(value as Output),
            reject,
        };
        if (commandMutationRuntime.mutationActive) {
            pending_mutations.push(pending);
            return;
        }
        startMutation(pending);
    });
}
