import { type CommandMutationOwner } from './commandMutationOwner';
import { toCommandMutationError } from './toCommandMutationError';

export async function waitForCommandMutationOwner(owner: CommandMutationOwner): Promise<void> {
    let observedCount = 0;
    let firstFailure: Error | null = null;

    while (observedCount < owner.pending.size) {
        const pending = Array.from(owner.pending).slice(observedCount);
        const results = await Promise.allSettled(pending);
        observedCount += pending.length;

        for (const result of results) {
            if (result.status === 'rejected' && firstFailure === null) {
                firstFailure = toCommandMutationError(result.reason);
            }
        }
    }

    if (firstFailure) {
        throw firstFailure;
    }
}
