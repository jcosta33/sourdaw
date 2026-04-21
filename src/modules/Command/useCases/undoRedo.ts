import { undoStore } from '../stores/undoStore';

import { type UndoEntry } from './commandQueries';
import { executeAppAction } from './executeAppAction';

async function executeUndo(entry: UndoEntry, runExecuteAppAction: typeof executeAppAction): Promise<void> {
    if (entry.kind === 'callback') {
        entry.undo();
    } else if (entry.inverseAction) {
        await runExecuteAppAction(entry.inverseAction);
    }
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

        for (let jIndex = groupEntries.length - 1; jIndex >= 0; jIndex--) {
            await executeUndo(groupEntries[jIndex]!, executeAppAction);
        }

        undoStore.set({
            past: newPast,
            future: [...groupEntries, ...state.future],
        });
        return;
    }

    await executeUndo(lastEntry, executeAppAction);

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
