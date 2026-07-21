import { type UndoEntry } from '../models/UndoEntry';
import { undoStore } from '../stores/undoStore';

import { executeAppAction } from './executeAppAction';
import { REDO_NOT_APPLIED } from './redoResult';
import { runUndoRedoExclusive } from './undoRedo';
import { undoTreeMoveTo } from './undoTree/undoTreeMoveTo';

/** The undo entry now at the top of `past`, or `null` when `past` is empty. */
function currentEntryId(past: readonly UndoEntry[]): string | null {
    return past.length > 0 ? past[past.length - 1]!.id : null;
}

async function executeRedo(entry: UndoEntry): Promise<boolean> {
    if (entry.kind === 'callback') {
        return entry.redo() !== REDO_NOT_APPLIED;
    }
    await executeAppAction(entry.action);
    return true;
}

async function redoImpl(): Promise<void> {
    const state = undoStore.value;
    if (!state || state.future.length === 0) {
        return;
    }

    let future = state.future;

    // Scan forwards until something is actually re-applied. Callback entries that
    // report REDO_NOT_APPLIED can never re-apply (their forward path is gone), so
    // they are dropped without reaching past — mirroring undo()'s inert-drop.
    // Pinning such an entry at future[0] would deadlock every redoable entry
    // behind it.
    while (future.length > 0) {
        const entry = future[0]!;
        future = future.slice(1);

        const applied = await executeRedo(entry);
        if (applied) {
            const newPast = [...state.past, entry];
            undoStore.set({
                past: newPast,
                future,
            });
            undoTreeMoveTo(currentEntryId(newPast));
            return;
        }
        // Not-applied entry: dropped; keep scanning.
    }

    // The whole future stack was not-applied: persist the purge so the wedge is gone.
    if (future.length !== state.future.length) {
        undoStore.set({ past: state.past, future });
        undoTreeMoveTo(currentEntryId(state.past));
    }
}

export function redo(): Promise<void> {
    return runUndoRedoExclusive(redoImpl);
}
