import { type CommandMutationOwner } from './commandMutationOwner';
import { type LegacyCommandMutation } from './legacyCommandMutationContract';
import { runCommandMutationUnderOwner } from './runCommandMutationUnderOwner';
import { runLegacyCommandMutationImpl } from './runLegacyCommandMutationImpl';

/** Run only when the caller already owns the Command mutation lease. */
export function runLegacyCommandMutationUnderOwner<Output>(
    owner: CommandMutationOwner,
    mutation: LegacyCommandMutation<Output>
): Promise<Output> {
    return runCommandMutationUnderOwner(owner, () => runLegacyCommandMutationImpl(owner, mutation));
}
