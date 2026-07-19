import { createEmptyTree, pushToTree } from '../../models/UndoTree';
import { type UndoStoreState } from '../../stores/undoStore';
import { undoTreeStore } from '../../stores/undoTree';

/** Rebuild the enabled tree from the authoritative linear undo/redo split. */
export function rebuildUndoTreeFromHistory(history: UndoStoreState): void {
    const state = undoTreeStore.value;
    if (!state?.enabled) {
        return;
    }

    let tree = createEmptyTree();
    for (const entry of history.past) {
        tree = pushToTree(tree, entry);
    }
    const currentNodeId = tree.currentNodeId;
    for (const entry of history.future) {
        tree = pushToTree(tree, entry);
    }

    undoTreeStore.set({
        ...state,
        tree: { ...tree, currentNodeId },
    });
}
