import { inject } from '#/infra/di/inject';
import { undoStore } from '../stores/undoStore';
import { executeAppAction } from './executeAppAction';
import { type UndoEntry } from '../models/UndoEntry';

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

export const undo = inject({ undoStore, executeAppAction })(
    ({ undoStore, executeAppAction }) =>
        async function undo(): Promise<void> {
            const state = undoStore.value;
            if (!state || state.past.length === 0) {
                return;
            }

            const lastEntry = state.past[state.past.length - 1]!;

            if (lastEntry.groupId) {
                const groupEntries: typeof state.past = [];
                let i = state.past.length - 1;
                while (i >= 0 && state.past[i]!.groupId === lastEntry.groupId) {
                    groupEntries.unshift(state.past[i]!);
                    i--;
                }
                const newPast = state.past.slice(0, i + 1);

                for (let j = groupEntries.length - 1; j >= 0; j--) {
                    await executeUndo(groupEntries[j]!, executeAppAction);
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
);

export const redo = inject({ undoStore, executeAppAction })(
    ({ undoStore, executeAppAction }) =>
        async function redo(): Promise<void> {
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
);

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
        for (let i = 0; i < stepsBack; i++) {
            await undo();
        }
    } else {
        const stepsForward = targetIndex - currentIndex;
        for (let i = 0; i < stepsForward; i++) {
            await redo();
        }
    }
}
