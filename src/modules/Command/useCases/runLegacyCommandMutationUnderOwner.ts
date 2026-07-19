import { commandMutationRuntime } from './commandMutationRuntime';
import { type LegacyCommandMutation } from './legacyCommandMutationContract';
import { runLegacyCommandMutationImpl } from './runLegacyCommandMutationImpl';

/** Run only when the caller already owns the Command mutation lease. */
export function runLegacyCommandMutationUnderOwner<Output>(mutation: LegacyCommandMutation<Output>): Promise<Output> {
    if (!commandMutationRuntime.mutationActive) {
        return Promise.reject(new Error('Legacy Command mutation requires an active owner'));
    }
    commandMutationRuntime.synchronousOwnerDepth += 1;
    try {
        return runLegacyCommandMutationImpl(mutation);
    } finally {
        commandMutationRuntime.synchronousOwnerDepth -= 1;
    }
}
