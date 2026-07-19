import { runCommandMutationExclusive } from './commandMutation';
import { executeAppActionImpl } from './executeAppActionImpl';

/**
 * Own one Command mutation lease while a caller captures a compound snapshot.
 * Nested actions use the non-acquiring executor so they cannot deadlock behind
 * unrelated work that is itself waiting for the snapshot transaction.
 */
export function runCommandSnapshotExclusive<Output>(
    operation: (executeAction: typeof executeAppActionImpl) => Promise<Output>
): Promise<Output> {
    return runCommandMutationExclusive(() => operation(executeAppActionImpl));
}
