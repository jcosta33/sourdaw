import { createEmptyTree } from '../models/UndoTree';
import { clearUndoHistory as clearUndoHistoryInStore } from '../stores/clearUndoHistory';
import { undoTreeStore } from '../stores/undoTree';

import { runCommandMutationExclusive } from './commandMutation';

function resetCommandHistory(): void {
    clearUndoHistoryInStore();
    const treeState = undoTreeStore.value;
    if (treeState) {
        undoTreeStore.set({ ...treeState, tree: createEmptyTree() });
    }
}

/**
 * Serialize a project-identity transition with actions, undo, redo, and group
 * reversion. The supplied reset capability is valid only inside this barrier,
 * keeping state publication and history invalidation in one awaited operation.
 */
export function runCommandTransitionExclusive<Output>(
    transition: (resetUndoHistory: () => void) => Promise<Output>
): Promise<Output> {
    return runCommandMutationExclusive(() => transition(resetCommandHistory));
}
