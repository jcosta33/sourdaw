import { createEmptyTree, pushToTree, type UndoTree } from '../../models/UndoTree';
import { type UndoStoreState } from '../../stores/undoStore';

/** Build the full linear history and restore the current node at the past/future split. */
export function buildUndoTreeFromHistory(history: UndoStoreState): UndoTree {
    let tree = createEmptyTree();
    for (const entry of history.past) {
        tree = pushToTree(tree, entry);
    }
    const currentNodeId = tree.currentNodeId;
    for (const entry of history.future) {
        tree = pushToTree(tree, entry);
    }
    return { ...tree, currentNodeId };
}
