import { runCommandMutationExclusive } from './commandMutation';
import { isCommandMutationExecutingSynchronously } from './isCommandMutationExecutingSynchronously';
import { type LegacyCommandMutation } from './legacyCommandMutationContract';
import { runLegacyCommandMutationImpl } from './runLegacyCommandMutationImpl';

/**
 * Own a legacy synchronous domain mutation and its history publication under
 * one Command lease. The callback starts in the initiating turn when the FIFO
 * is idle and is deferred whole when an older action/replay owns the lease.
 */
export function runLegacyCommandMutation<Output>(mutation: LegacyCommandMutation<Output>): Promise<Output> {
    if (isCommandMutationExecutingSynchronously()) {
        return runLegacyCommandMutationImpl(mutation);
    }
    return runCommandMutationExclusive(() => runLegacyCommandMutationImpl(mutation));
}
