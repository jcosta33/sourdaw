import { undoStore, type UndoStoreState } from '../stores/undoStore';
import { undoTreeStore, type UndoTreeStoreState } from '../stores/undoTree';

/**
 * The complete undo-history snapshot: the stacks plus the tree mirror. The
 * mirror carries state the stacks cannot recover — nodes for the redo `future`
 * segment, the cursor, branch labels, active branches at forks — so a
 * compensation that restores it wholesale stays faithful.
 */
export type UndoHistorySnapshot = UndoStoreState & {
    /** Mirror state at capture; `null` when the mirror store held no value. */
    undoTree: UndoTreeStoreState | null;
};

/**
 * Snapshot the full undo history: the undo/redo stacks (each entry's action and
 * inverse action included) and the branching tree mirror as both stood at
 * capture time. The read-only `undoStore` exposed from `Command/stores` freezes
 * entries down to their `label` for display, which is not enough to restore a
 * working undo history — so callers that need to roll back a failed transaction
 * capture through this use case instead, then pass the result to
 * `restoreUndoHistory`.
 */
export function captureUndoHistory(): UndoHistorySnapshot {
    const state = undoStore.value;
    const stacks: UndoStoreState = state
        ? { past: [...state.past], future: [...state.future] }
        : { past: [], future: [] };
    return { ...stacks, undoTree: undoTreeStore.value };
}
