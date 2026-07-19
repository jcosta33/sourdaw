import { runCommandMutationExclusive } from './commandMutation';
import { type CommandMutationOwner } from './commandMutationOwner';

export function runUndoRedoExclusive(operation: (owner: CommandMutationOwner) => Promise<void>): Promise<void> {
    return runCommandMutationExclusive(operation);
}
