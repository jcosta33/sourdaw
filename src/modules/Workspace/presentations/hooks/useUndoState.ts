/**
 * useUndoState — local re-implementation using undoStore (contract).
 */
import { useStore } from '#/infra/store/useStore';
import { undoStore, type UndoStoreState } from '#/modules/Command/stores/undoStore';

const defaultState: UndoStoreState = { past: [], future: [] };

export const useUndoState = () => {
    const state = useStore(undoStore, defaultState);

    return {
        canUndo: state.past.length > 0,
        canRedo: state.future.length > 0,
        lastAction: state.past[state.past.length - 1] ?? null,
        undoCount: state.past.length,
    };
};
