import { undoStore, type UndoStoreState } from '../stores/undoStore';

/**
 * Restore undo/redo stacks captured earlier by `captureUndoHistory`. Used to
 * roll back a `clearUndoHistory()` call once a transaction that depended on
 * it fails, so the undo history a user had before the attempt is not lost.
 */
export function restoreUndoHistory(state: UndoStoreState): void {
    undoStore.set(state);
}
