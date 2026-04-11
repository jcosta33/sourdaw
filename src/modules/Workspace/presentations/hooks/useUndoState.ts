/**
 * useUndoState — local re-implementation using undoStore (contract).
 */
import { useStore } from '#/infra/store/useStore';
import { undoStore } from '#/modules/Command/stores';

type UndoHistoryEntry = {
    label: string;
};

type UndoViewState = {
    past: UndoHistoryEntry[];
    future: UndoHistoryEntry[];
};

const defaultState: UndoViewState = { past: [], future: [] };

export const useUndoState = () => {
    const state = useStore(undoStore, defaultState);

    return {
        canUndo: state.past.length > 0,
        canRedo: state.future.length > 0,
        lastAction: state.past[state.past.length - 1] ?? null,
        undoCount: state.past.length,
    };
};
