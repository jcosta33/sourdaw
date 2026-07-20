import { type UndoEntry } from '../models/UndoEntry';
import { undoStore } from '../stores/undoStore';

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
 * actually undone. Action entries without an `inverseAction` are inert: undoing
 * them is a no-op, so the caller drops them instead of leaving them to wedge
 * the stack above older undoable entries. Dropped inert entries never reach
 * `future` — nothing was undone, so redo must not re-apply their action.
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
    const initial = undoStore.value;
    if (!initial || initial.past.length === 0) {
        return;
    }

    let past = initial.past;
    const future = initial.future;

    // Scan downwards until something is actually undone. Inert entries (action
    // entries without an inverseAction) are dropped along the way so they can
    // never wedge the undoable entries beneath them.
    while (past.length > 0) {
        const lastEntry = past[past.length - 1]!;

        if (lastEntry.groupId) {
            const groupEntries: UndoEntry[] = [];
            let index = past.length - 1;
            while (index >= 0 && past[index]!.groupId === lastEntry.groupId) {
                groupEntries.unshift(past[index]!);
                index--;
            }
            past = past.slice(0, index + 1);

            const undoneEntries: UndoEntry[] = [];
            for (let groupIndex = groupEntries.length - 1; groupIndex >= 0; groupIndex--) {
                const entry = groupEntries[groupIndex]!;
                const undone = await executeUndo({
                    entry,
                    runExecuteAppAction: executeAppAction,
                });
                if (undone) {
                    undoneEntries.unshift(entry);
                }
            }

            if (undoneEntries.length > 0) {
                undoStore.set({
                    past,
                    future: [...undoneEntries, ...future],
                });
                undoTreeMoveTo(currentEntryId(past));
                return;
            }
            // The whole group was inert: it is dropped; keep scanning.
            continue;
        }

        const undone = await executeUndo({
            entry: lastEntry,
            runExecuteAppAction: executeAppAction,
        });
        past = past.slice(0, -1);
        if (undone) {
            undoStore.set({
                past,
                future: [lastEntry, ...future],
            });
            undoTreeMoveTo(currentEntryId(past));
            return;
        }
        // Inert entry: dropped without reaching future; keep scanning.
    }

    // The stack held only inert entries: persist the purge so the wedge is gone.
    if (past.length !== initial.past.length) {
        undoStore.set({ past, future });
        undoTreeMoveTo(currentEntryId(past));
    }
}

export function undo(): Promise<void> {
    return runUndoRedoExclusive(undoImpl);
}
