import { undoStore } from "../stores/undoStore";
import { executeAppAction } from "./executeAppAction";

export const undo = async (): Promise<void> => {
    const state = undoStore.value;
    if (!state || state.past.length === 0) return;

    const entry = state.past[state.past.length - 1]!;
    const newPast = state.past.slice(0, -1);

    if (entry.inverseAction) {
        await executeAppAction(entry.inverseAction);
    }

    undoStore.set({
        past: newPast,
        future: [entry, ...state.future],
    });
};

export const redo = async (): Promise<void> => {
    const state = undoStore.value;
    if (!state || state.future.length === 0) return;

    const entry = state.future[0]!;
    const newFuture = state.future.slice(1);

    await executeAppAction(entry.action);

    undoStore.set({
        past: [...state.past, entry],
        future: newFuture,
    });
};

export const canUndo = (): boolean => {
    const state = undoStore.value;
    return (state?.past.length ?? 0) > 0;
};

export const canRedo = (): boolean => {
    const state = undoStore.value;
    return (state?.future.length ?? 0) > 0;
};
