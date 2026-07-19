import { runCommandMutationExclusive } from './commandMutation';
import { executeAppActionImpl } from './executeAppActionImpl';

type CommandActionExecutor = (
    action: Parameters<typeof executeAppActionImpl>[0],
    options?: Parameters<typeof executeAppActionImpl>[1]
) => Promise<void>;

/**
 * Own one Command mutation lease while a caller captures a compound snapshot.
 * Nested actions use the non-acquiring executor so they cannot deadlock behind
 * unrelated work that is itself waiting for the snapshot transaction.
 */
export function runCommandSnapshotExclusive<Output>(
    operation: (executeAction: CommandActionExecutor) => Promise<Output>
): Promise<Output> {
    return runCommandMutationExclusive((owner) =>
        operation((action, options) => executeAppActionImpl(action, options, owner))
    );
}
