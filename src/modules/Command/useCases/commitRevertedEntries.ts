import { type UndoEntry } from '../models/UndoEntry';
import { undoStore } from '../stores/undoStore';

import { undoTreeMoveTo } from './undoTree/undoTreeMoveTo';

/**
 * Moves reverted entries from `past` to the front of `future`, read against the live stacks so an
 * entry committed while the inverses ran keeps its place, and moves the undo tree to the new top of
 * `past`.
 */
export function commitRevertedEntries(entries: readonly UndoEntry[]): void {
    const liveState = undoStore.value;
    if (!liveState || entries.length === 0) {
        return;
    }
    const revertedIds = new Set(entries.map((entry) => entry.id));
    const past = liveState.past.filter((entry) => !revertedIds.has(entry.id));
    undoStore.set({ past, future: [...entries, ...liveState.future] });
    undoTreeMoveTo(past.length > 0 ? past[past.length - 1]!.id : null);
}
