import { type UndoEntry } from '../models/UndoEntry';
import { undoStore } from '../stores/undoStore';

import { executeAppAction } from './executeAppAction';
import { revertUndoEntriesAtomically } from './revertUndoEntriesAtomically';
import { runUndoRedoExclusive } from './undoRedo';
import { undoTreeMoveTo } from './undoTree/undoTreeMoveTo';

/** The undo entry now at the top of `past`, or `null` when `past` is empty. */
function currentEntryId(past: readonly UndoEntry[]): string | null {
    return past.length > 0 ? past[past.length - 1]!.id : null;
}

type ExecuteUndoInput = {
    entry: UndoEntry;
    runExecuteAppAction: typeof executeAppAction;
};

/**
 * Performs the undo side-effect for one entry and reports whether anything was
 * actually undone. Inert action entries stay in `past` so redo cannot double-apply.
 */
async function executeUndo({ entry, runExecuteAppAction }: ExecuteUndoInput): Promise<boolean> {
    if (entry.kind === 'callback') {
        entry.undo();
        return true;
    }
    if (entry.inverseAction) {
        await runExecuteAppAction(entry.inverseAction, {
            skipUndo: true,
            skipMacroRecording: true,
        });
        return true;
    }
    return false;
}

async function undoImpl(): Promise<void> {
    const state = undoStore.value;
    if (!state || state.past.length === 0) {
        return;
    }

    const lastEntry = state.past[state.past.length - 1]!;

    if (lastEntry.transactionGroupId) {
        const groupEntries: UndoEntry[] = [];
        let index = state.past.length - 1;
        while (index >= 0 && state.past[index]!.transactionGroupId === lastEntry.transactionGroupId) {
            groupEntries.unshift(state.past[index]!);
            index--;
        }
        const newPast = state.past.slice(0, index + 1);

        const undone = await revertUndoEntriesAtomically(groupEntries);
        if (!undone) {
            return;
        }

        undoStore.set({
            past: newPast,
            future: [...groupEntries, ...state.future],
        });
        undoTreeMoveTo(currentEntryId(newPast));
        return;
    }

    const undone = await executeUndo({
        entry: lastEntry,
        runExecuteAppAction: executeAppAction,
    });
    if (!undone) {
        return;
    }

    const newPast = state.past.slice(0, -1);
    undoStore.set({
        past: newPast,
        future: [lastEntry, ...state.future],
    });
    undoTreeMoveTo(currentEntryId(newPast));
}

export function undo(): Promise<void> {
    return runUndoRedoExclusive(undoImpl);
}
