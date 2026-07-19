import { runCommandMutationExclusive } from './commandMutation';
import { commandMutationRuntime } from './commandMutationRuntime';
import { type LegacyCommandMutation } from './legacyCommandMutationContract';
import { runLegacyCommandMutationUnderOwner } from './runLegacyCommandMutationUnderOwner';

/**
 * Own a legacy synchronous domain mutation and its history publication under
 * one Command lease. The callback starts in the initiating turn when the FIFO
 * is idle and is deferred whole when an older action/replay owns the lease.
 */
export function runLegacyCommandMutation<Output>(mutation: LegacyCommandMutation<Output>): Promise<Output> {
    const synchronous_owner = commandMutationRuntime.synchronousOwner;
    if (synchronous_owner) {
        return runLegacyCommandMutationUnderOwner(synchronous_owner, mutation);
    }
    return runCommandMutationExclusive((owner) => runLegacyCommandMutationUnderOwner(owner, mutation));
}
