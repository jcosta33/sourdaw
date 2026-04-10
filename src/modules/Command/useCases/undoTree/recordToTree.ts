import { type UndoEntry } from '../commandQueries';
import { pushToTree } from '../../models/UndoTree';
import { undoTreeStore } from '../../stores/undoTree';

/**
 * Called from undoStore subscriber to mirror entries into the tree.
 * Only records when the tree is enabled.
 */
export function recordToTree(entry: UndoEntry): void {
    const state = undoTreeStore.value;
    if (!state || !state.enabled) {
        return;
    }
    undoTreeStore.set({
        ...state,
        tree: pushToTree(state.tree, entry),
    });
}
