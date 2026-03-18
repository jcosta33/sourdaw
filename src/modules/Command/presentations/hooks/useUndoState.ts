import { useSyncExternalStore } from 'react';
import { undoStore, type UndoStoreState } from '../../stores/undoStore';

const defaultState: UndoStoreState = { past: [], future: [] };

export const useUndoState = () => {
    const state = useSyncExternalStore(
        (onChange) => undoStore.subscribe(() => onChange()),
        () => undoStore.value ?? defaultState,
        () => undoStore.value ?? defaultState
    );

    return {
        canUndo: state.past.length > 0,
        canRedo: state.future.length > 0,
        lastAction: state.past[state.past.length - 1] ?? null,
        undoCount: state.past.length,
    };
};
