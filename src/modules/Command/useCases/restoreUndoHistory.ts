import { undoStore } from '../stores/undoStore';
import { undoTreeStore } from '../stores/undoTree';

import { type UndoHistorySnapshot } from './captureUndoHistory';
import { rebuildTreeFromPast } from './undoTree/rebuildTreeFromPast';

/**
 * Restore an undo-history snapshot captured earlier by `captureUndoHistory`. Used to
 * roll back a `clearUndoHistory()` call once a transaction that depended on
 * it fails, so the undo history a user had before the attempt is not lost.
 */
export function restoreUndoHistory(state: UndoHistorySnapshot): void {
    undoStore.set(state);
    if (state.undoTree) {
        // A faithful compensation restores the mirror wholesale: it carries nodes for
        // the redo `future` segment, the cursor, and mirror-only state (branch labels,
        // active branches at forks) no stack-derived rebuild can recover.
        undoTreeStore.set(state.undoTree);
        return;
    }
    // Defensive fallback for a snapshot carrying no mirror state: re-derive what
    // the restored `past` implies, or restored history has no tree nodes.
    const undoTreeState = undoTreeStore.value;
    if (!undoTreeState || !undoTreeState.enabled) {
        return;
    }
    undoTreeStore.set({ ...undoTreeState, tree: rebuildTreeFromPast(state.past) });
}
