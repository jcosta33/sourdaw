import { undoStore } from '../stores/undoStore';

import { type UndoEntry } from './commandQueries';
import { executeAppAction } from './executeAppAction';
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
        await runExecuteAppAction(entry.inverseAction, { skipUndo: true });
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

    if (lastEntry.groupId) {
        const groupEntries: UndoEntry[] = [];
        let index = state.past.length - 1;
        while (index >= 0 && state.past[index]!.groupId === lastEntry.groupId) {
            groupEntries.unshift(state.past[index]!);
            index--;
        }
        const newPast = state.past.slice(0, index + 1);

        let anyUndone = false;
        for (let groupIndex = groupEntries.length - 1; groupIndex >= 0; groupIndex--) {
            const undone = await executeUndo({
                entry: groupEntries[groupIndex]!,
                runExecuteAppAction: executeAppAction,
            });
            anyUndone = anyUndone || undone;
        }

        if (!anyUndone) {
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
