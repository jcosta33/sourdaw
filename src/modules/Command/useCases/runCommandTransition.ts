import { createEmptyTree } from '../models/UndoTree';
import { clearUndoHistory } from '../stores/clearUndoHistory';
import { undoTreeStore } from '../stores/undoTree';

function resetCommandHistory(): void {
    clearUndoHistory();
    const treeState = undoTreeStore.value;
    if (treeState) {
        undoTreeStore.set({ ...treeState, tree: createEmptyTree() });
    }
}

/** Run a transition while the caller already owns the Command mutation lease. */
export function runCommandTransition<Output>(
    transition: (resetCommandHistory: () => void) => Promise<Output>
): Promise<Output> {
    return transition(resetCommandHistory);
}
