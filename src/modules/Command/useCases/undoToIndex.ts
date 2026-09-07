import { type UndoEntry } from '../models/UndoEntry';
import { undoStore } from '../stores/undoStore';

import { redo } from './redo';
import { undo } from './undo';
import { undoTreeMoveTo } from './undoTree/undoTreeMoveTo';

/** Inert action entries can never be undone or redone; `undo()` drops them on
 *  sight. `undoToIndex` drops them one at a time instead, so a history sweep
 *  stops exactly at the target row instead of undoing past it. */
function isInertActionEntry(entry: UndoEntry): boolean {
    return entry.kind === 'action' && entry.inverseAction === null;
}

function currentEntryId(past: readonly UndoEntry[]): string | null {
    return past.length > 0 ? past[past.length - 1]!.id : null;
}

export async function undoToIndex(targetIndex: number): Promise<void> {
    const initial = undoStore.value;
    if (!initial) {
        return;
    }

    const currentIndex = initial.past.length - 1;
    if (targetIndex === currentIndex) {
        return;
    }

    if (targetIndex > currentIndex) {
        // Forward: re-read the store every step. redo() consumes a variable
        // number of entries (it drops not-applied ones while scanning for
        // something applicable), so a fixed call count computed up front
        // overshoots the row the user clicked.
        for (;;) {
            const state = undoStore.value;
            if (!state || state.past.length - 1 >= targetIndex || state.future.length === 0) {
                return;
            }
            const pastBefore = state.past.length;
            const futureBefore = state.future.length;
            await redo();
            const after = undoStore.value;
            if (!after || (after.past.length === pastBefore && after.future.length === futureBefore)) {
                // No-progress guard: redo() declined to consume anything.
                return;
            }
        }
    }

    // Backward: re-read the store every step. undo() consumes a variable number
    // of entries (it drops inert ones before undoing), so a fixed call count
    // computed up front overshoots the row the user clicked.
    for (;;) {
        const state = undoStore.value;
        if (!state || state.past.length - 1 <= targetIndex) {
            return;
        }
        const head = state.past[state.past.length - 1]!;
        if (isInertActionEntry(head)) {
            // Drop only the inert head. Letting undo() sweep it would also undo
            // the next undoable entry, crossing the target row.
            const newPast = state.past.slice(0, -1);
            undoStore.set({ past: newPast, future: state.future });
            undoTreeMoveTo(currentEntryId(newPast));
            continue;
        }
        // The sweep is anchor-targeted: the row it stops at is the row the user
        // clicked to KEEP, so it never steps over a conflicted head onto the
        // entry beneath — that would undo the target row itself (#2881).
        const outcome = await undo({ stepOverConflicts: false });
        if (!outcome.headConsumed) {
            // The head entry is still applied, so this sweep cannot reach the target.
            // Stack length cannot stand in for progress: one undo() also drops any
            // inert entries it passes, so `past` shortening says nothing about
            // whether the entry the sweep stopped at was undone.
            return;
        }
    }
}
