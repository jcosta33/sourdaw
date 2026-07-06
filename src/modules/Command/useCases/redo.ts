import { undoStore } from '../stores/undoStore';

import { type UndoEntry } from './commandQueries';
import { executeAppAction } from './executeAppAction';
import { runUndoRedoExclusive } from './undoRedo';
import { undoTreeMoveTo } from './undoTree/undoTreeMoveTo';

/** The undo entry now at the top of `past`, or `null` when `past` is empty. */
function currentEntryId(past: readonly UndoEntry[]): string | null {
    return past.length > 0 ? past[past.length - 1]!.id : null;
}

async function executeRedo(entry: UndoEntry): Promise<void> {
    if (entry.kind === 'callback') {
        entry.redo();
        return;
    }
    await executeAppAction(entry.action);
}

async function redoImpl(): Promise<void> {
    const state = undoStore.value;
    if (!state || state.future.length === 0) {
        return;
    }

    const entry = state.future[0]!;
    const newFuture = state.future.slice(1);

    await executeRedo(entry);

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
