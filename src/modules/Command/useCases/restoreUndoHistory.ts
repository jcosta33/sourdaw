import { undoStore, type UndoStoreState } from '../stores/undoStore';
import { undoTreeStore } from '../stores/undoTree';

import { rebuildTreeFromPast } from './undoTree/rebuildTreeFromPast';

/**
 * Restore undo/redo stacks captured earlier by `captureUndoHistory`. Used to
 * roll back a `clearUndoHistory()` call once a transaction that depended on
 * it fails, so the undo history a user had before the attempt is not lost.
 */
export function restoreUndoHistory(state: UndoStoreState): void {
    undoStore.set(state);
    const undoTreeState = undoTreeStore.value;
    if (!undoTreeState || !undoTreeState.enabled) {
        return;
    }
    // Failure compensation must restore the mirror too, or the restored history
    // has no tree nodes: the clear that preceded the failure emptied the tree.
    undoTreeStore.set({ ...undoTreeState, tree: rebuildTreeFromPast(state.past) });
}
