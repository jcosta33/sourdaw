import { undoStore } from '../stores/undoStore';

import { type UndoEntry } from './commandQueries';
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

    const entry = state.future[0]!;
    const newFuture = state.future.slice(1);

    const applied = await executeRedo(entry);
    if (!applied) {
        return;
    }

    const newPast = [...state.past, entry];
    undoStore.set({
        past: newPast,
        future: newFuture,
    });
    undoTreeMoveTo(currentEntryId(newPast));
}

export function redo(): Promise<void> {
    return runUndoRedoExclusive(redoImpl);
}
