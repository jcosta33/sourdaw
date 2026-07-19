import { runCommandMutationExclusive } from './commandMutation';

export function runUndoRedoExclusive(operation: () => Promise<void>): Promise<void> {
    return runCommandMutationExclusive(operation);
}
