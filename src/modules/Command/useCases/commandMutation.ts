import { createCommandMutationOwner, type CommandMutationOwner } from './commandMutationOwner';
import { commandMutationRuntime } from './commandMutationRuntime';
import { toCommandMutationError } from './toCommandMutationError';
import { waitForCommandMutationOwner } from './waitForCommandMutationOwner';

/**
 * Command operations read domain/history state, may await handler work, then
 * commit linear and tree history. One FIFO chain prevents another action,
 * undo, redo, or group reversion from publishing against a stale snapshot.
 * Internal replay uses `executeAppActionImpl` so it remains inside the owning
 * operation instead of reacquiring this lock.
 */
type PendingMutation = {
    operation: (owner: CommandMutationOwner) => unknown;
    resolve: (value: unknown) => void;
    reject: (error: unknown) => void;
};

const pendingMutations: PendingMutation[] = [];
let drainScheduled = false;

function startMutation({ operation, resolve, reject }: PendingMutation): void {
    const owner = createCommandMutationOwner();
    commandMutationRuntime.activeOwner = owner;
    const previousSynchronousOwner = commandMutationRuntime.synchronousOwner;
    commandMutationRuntime.synchronousOwner = owner;
    let result: Promise<unknown>;
    try {
        // Start synchronously. Legacy UI mutations historically publish in the
        // initiating turn when no older Command owner is active.
        result = Promise.resolve(operation(owner));
    } catch (error) {
        result = Promise.reject(toCommandMutationError(error));
    } finally {
        if (commandMutationRuntime.synchronousOwner === owner) {
            commandMutationRuntime.synchronousOwner = previousSynchronousOwner;
        }
    }

    void settleMutation({ owner, result, resolve, reject });
}

type SettleMutationInput = {
    owner: CommandMutationOwner;
    result: Promise<unknown>;
    resolve: (value: unknown) => void;
    reject: (error: unknown) => void;
};

async function settleMutation({ owner, result, resolve, reject }: SettleMutationInput): Promise<void> {
    let output: unknown;
    let failure: unknown;
    let failed = false;
    try {
        output = await result;
    } catch (error) {
        failed = true;
        failure = error;
    }

    try {
        await waitForCommandMutationOwner(owner);
    } catch (error) {
        if (!failed) {
            failed = true;
            failure = error;
        }
    }

    if (failed) {
        reject(failure);
    } else {
        resolve(output);
    }
    finishMutation(owner);
}

function finishMutation(owner: CommandMutationOwner): void {
    owner.active = false;
    if (commandMutationRuntime.activeOwner === owner) {
        commandMutationRuntime.activeOwner = null;
    }
    if (drainScheduled) {
        return;
    }
    drainScheduled = true;
    queueMicrotask(() => {
        drainScheduled = false;
        if (commandMutationRuntime.activeOwner) {
            return;
        }
        const next = pendingMutations.shift();
        if (next) {
            startMutation(next);
        }
    });
}

export function runCommandMutationExclusive<Output>(
    operation: (owner: CommandMutationOwner) => Promise<Output> | Output
): Promise<Output> {
    return new Promise<Output>((resolve, reject) => {
        const pending: PendingMutation = {
            operation,
            resolve: (value) => resolve(value as Output),
            reject,
        };
        if (commandMutationRuntime.activeOwner) {
            pendingMutations.push(pending);
            return;
        }
        startMutation(pending);
    });
}
