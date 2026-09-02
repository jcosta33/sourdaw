import { undoStore, type UndoStoreState } from '../stores/undoStore';

/**
 * Snapshot the full undo/redo stacks, including each entry's action and
 * inverse action. The read-only `undoStore` exposed from `Command/stores`
 * freezes entries down to their `label` for display, which is not enough to
 * restore a working undo history — so callers that need to roll back a
 * failed transaction capture through this use case instead, then pass the
 * result to `restoreUndoHistory`.
 */
export function captureUndoHistory(): UndoStoreState {
    const state = undoStore.value;
    if (!state) {
        return { past: [], future: [] };
    }
    return { past: [...state.past], future: [...state.future] };
}
