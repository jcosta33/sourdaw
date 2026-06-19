import { undoStore } from '../stores/undoStore';

import { type UndoEntry } from './commandQueries';
import { executeAppAction } from './executeAppAction';

/**
 * Performs the undo side-effect for one entry and reports whether anything was
 * actually undone. An `action` entry with no `inverseAction` cannot be undone — the
 * caller must NOT consume such an entry (move it past→future), or the undo stack
 * desyncs from real state: the user's undo would be a silent no-op while a later redo
 * re-executes the action, double-applying it. Returning `false` lets the caller leave
 * the entry in place so the failure surfaces instead of being masked.
 */
async function executeUndo(entry: UndoEntry, runExecuteAppAction: typeof executeAppAction): Promise<boolean> {
    if (entry.kind === 'callback') {
        entry.undo();
        return true;
    }
    if (entry.inverseAction) {
        await runExecuteAppAction(entry.inverseAction);
        return true;
    }
    return false;
}

async function executeRedo(entry: UndoEntry, runExecuteAppAction: typeof executeAppAction): Promise<void> {
    if (entry.kind === 'callback') {
        entry.redo();
    } else {
        await runExecuteAppAction(entry.action);
    }
}

export async function undo(): Promise<void> {
    const state = undoStore.value;
    if (!state || state.past.length === 0) {
        return;
    }

    const lastEntry = state.past[state.past.length - 1]!;

    if (lastEntry.groupId) {
        const groupEntries: typeof state.past = [];
        let index = state.past.length - 1;
        while (index >= 0 && state.past[index]!.groupId === lastEntry.groupId) {
            groupEntries.unshift(state.past[index]!);
            index--;
        }
        const newPast = state.past.slice(0, index + 1);

        let anyUndone = false;
        for (let jIndex = groupEntries.length - 1; jIndex >= 0; jIndex--) {
            const undone = await executeUndo(groupEntries[jIndex]!, executeAppAction);
            anyUndone = anyUndone || undone;
        }

        // If no member of the group could be undone, the operation was inert — leave the
        // group in `past` rather than silently consuming it (which would let a later redo
        // re-apply the actions). See executeUndo.
        if (!anyUndone) {
            return;
        }

        undoStore.set({
            past: newPast,
            future: [...groupEntries, ...state.future],
        });
        return;
    }

    const undone = await executeUndo(lastEntry, executeAppAction);
    // An inert undo (no inverse, no callback) must not consume the entry — doing so
    // desyncs the stack from real state. See executeUndo.
    if (!undone) {
        return;
    }

    const newPast = state.past.slice(0, -1);
    undoStore.set({
        past: newPast,
        future: [lastEntry, ...state.future],
    });
}

export async function redo(): Promise<void> {
    const state = undoStore.value;
    if (!state || state.future.length === 0) {
        return;
    }

    const entry = state.future[0]!;
    const newFuture = state.future.slice(1);

    await executeRedo(entry, executeAppAction);

    undoStore.set({
        past: [...state.past, entry],
        future: newFuture,
    });
}

export async function undoToIndex(targetIndex: number): Promise<void> {
    const state = undoStore.value;
    if (!state) {
        return;
    }

    const currentIndex = state.past.length - 1;
    if (targetIndex === currentIndex) {
        return;
    }

    if (targetIndex < currentIndex) {
        const stepsBack = currentIndex - targetIndex;
        for (let index = 0; index < stepsBack; index++) {
            await undo();
        }
    } else {
        const stepsForward = targetIndex - currentIndex;
        for (let index = 0; index < stepsForward; index++) {
            await redo();
        }
    }
}
