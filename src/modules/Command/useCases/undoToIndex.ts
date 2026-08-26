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
        // The clicked row is a destination, so a conflicted head must stop the sweep
        // rather than be stepped over: the entry a step-over reverts can be exactly
        // the row the user asked to keep, and stopping afterwards is too late.
        const outcome = await undo({ allowStepOver: false });
        if (!outcome.headConsumed) {
            // The head entry is still on `past`, so this sweep cannot reach the target.
            // Stack length cannot stand in for progress: `past` can shorten while the
            // row this sweep must stop at still stands.
            return;
        }
    }
}
