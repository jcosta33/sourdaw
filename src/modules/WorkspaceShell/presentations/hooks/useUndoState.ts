/**
 * useUndoState — the undo history counted in undo steps, the units one Cmd+Z
 * reverts, read from the Command step store contract.
 */
import { useStore } from '#/infra/store/useStore';
import { undoStepStore, type UndoStepStoreState } from '#/modules/Command/stores';

const defaultState: UndoStepStoreState = { pastSteps: [], futureSteps: [] };

export const useUndoState = () => {
    const state = useStore(undoStepStore, defaultState);

    return {
        canUndo: state.pastSteps.length > 0,
        canRedo: state.futureSteps.length > 0,
        lastAction: state.pastSteps[state.pastSteps.length - 1] ?? null,
        undoCount: state.pastSteps.length,
    };
};
