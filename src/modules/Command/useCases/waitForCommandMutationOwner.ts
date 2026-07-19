import { type CommandMutationOwner } from './commandMutationOwner';
import { toCommandMutationError } from './toCommandMutationError';

export async function waitForCommandMutationOwner(owner: CommandMutationOwner): Promise<void> {
    let observed_count = 0;
    let first_failure: Error | null = null;

    while (observed_count < owner.pending.size) {
        const pending = Array.from(owner.pending).slice(observed_count);
        const results = await Promise.allSettled(pending);
        observed_count += pending.length;

        for (const result of results) {
            if (result.status === 'rejected' && first_failure === null) {
                first_failure = toCommandMutationError(result.reason);
            }
        }
    }

    if (first_failure) {
        throw first_failure;
    }
}
