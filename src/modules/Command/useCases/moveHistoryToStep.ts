import { type UndoEntry } from '../models/UndoEntry';
import { isInertUndoEntry } from '../models/UndoUnit';
import { undoStore } from '../stores/undoStore';

import { redo } from './redo';
import { undo } from './undo';
import { undoTreeMoveTo } from './undoTree/undoTreeMoveTo';

function holds(entries: readonly UndoEntry[], entryId: string): boolean {
    return entries.some((entry) => entry.id === entryId);
}

function currentEntryId(past: readonly UndoEntry[]): string | null {
    return past.length > 0 ? past[past.length - 1]!.id : null;
}

/**
 * Undo until `entryId` is the newest applied entry. The store is re-read every
 * lap, because undo() and redo() consume a variable number of entries, so a
 * position computed up front drifts from the entry it named.
 */
async function undoUntilNewest(entryId: string): Promise<void> {
    for (;;) {
        const state = undoStore.value;
        const head = state?.past[state.past.length - 1];
        if (!state || !head || head.id === entryId || !holds(state.past, entryId)) {
            return;
        }
        if (isInertUndoEntry(head)) {
            // Drop only the inert head. Letting undo() sweep it would also undo
            // the next undoable entry, which may be the one to keep.
            const newPast = state.past.slice(0, -1);
            undoStore.set({ past: newPast, future: state.future });
            undoTreeMoveTo(currentEntryId(newPast));
            continue;
        }
        // Never step over a conflicted head: the entry beneath it may be the one
        // the user asked to keep (#2881).
        const outcome = await undo({ stepOverConflicts: false });
        if (!outcome.headConsumed) {
            return;
        }
    }
}

/** Redo until `entryId` is applied, or until redo drops it or applies nothing. */
async function redoUntilApplied(entryId: string): Promise<void> {
    for (;;) {
        const state = undoStore.value;
        if (!state || holds(state.past, entryId) || !holds(state.future, entryId)) {
            return;
        }
        const pastBefore = state.past.length;
        // Never step over a conflicted unit: the unit behind it is one no row names.
        await redo({ stepOverConflicts: false });
        const after = undoStore.value;
        // redo() reports nothing, but with step-over off one call applies at
        // most the head unit, so a `past` that did not grow means that unit
        // conflicted (any not-applied entries it purged first never reach
        // `past`) and the target cannot be reached in order.
        if (!after || after.past.length === pastBefore) {
            return;
        }
    }
}

/**
 * Move the history so the step whose `targetEntryId` is given becomes the
 * newest applied step: undo back to it when it is applied, redo through it
 * when it is undone. The target is an entry identity, never a position, so
 * entries undo or redo drop on the way cannot shift where the move stops.
 */
export async function moveHistoryToStep(targetEntryId: string): Promise<void> {
    const state = undoStore.value;
    if (!state) {
        return;
    }
    if (holds(state.past, targetEntryId)) {
        await undoUntilNewest(targetEntryId);
        return;
    }
    await redoUntilApplied(targetEntryId);
}
