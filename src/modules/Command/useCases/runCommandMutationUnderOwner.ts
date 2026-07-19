import { type CommandMutationOwner } from './commandMutationOwner';
import { commandMutationRuntime } from './commandMutationRuntime';
import { isCommandMutationOwnerActive } from './isCommandMutationOwnerActive';
import { toCommandMutationError } from './toCommandMutationError';

export function runCommandMutationUnderOwner<Output>(
    owner: CommandMutationOwner,
    operation: () => Promise<Output> | Output
): Promise<Output> {
    if (!isCommandMutationOwnerActive(owner)) {
        return Promise.reject(new Error('Command mutation owner is no longer active'));
    }

    const previousSynchronousOwner = commandMutationRuntime.synchronousOwner;
    commandMutationRuntime.synchronousOwner = owner;
    let result: Promise<Output>;
    try {
        result = Promise.resolve(operation());
    } catch (error) {
        result = Promise.reject(toCommandMutationError(error));
    } finally {
        commandMutationRuntime.synchronousOwner = previousSynchronousOwner;
    }

    owner.pending.add(result);
    void result.catch(() => undefined);
    return result;
}
