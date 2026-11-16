/**
 * useUndoState — the undo history counted in undo steps, the units one Cmd+Z
 * reverts, read from the Command step store contract.
 */
import { useStoreSelector } from '#/infra/store/useStoreSelector';
import { undoStepStore, type UndoStepStoreState } from '#/modules/Command/stores';

type UndoState = {
    canUndo: boolean;
    canRedo: boolean;
    lastAction: UndoStepStoreState['pastSteps'][number] | null;
    undoCount: number;
};

const selectUndoState = (state: UndoStepStoreState | null): UndoState => {
    const pastSteps = state?.pastSteps ?? [];
    return {
        canUndo: pastSteps.length > 0,
        canRedo: (state?.futureSteps.length ?? 0) > 0,
        lastAction: pastSteps[pastSteps.length - 1] ?? null,
        undoCount: pastSteps.length,
    };
};

// Every snapshot rebuilds its step objects, so a step is the same step when its key and label match.
const isSameUndoState = (a: UndoState, b: UndoState): boolean =>
    a.canUndo === b.canUndo &&
    a.canRedo === b.canRedo &&
    a.undoCount === b.undoCount &&
    a.lastAction?.key === b.lastAction?.key &&
    a.lastAction?.label === b.lastAction?.label;

export const useUndoState = (): UndoState => useStoreSelector(undoStepStore, selectUndoState, isSameUndoState);

type UndoAvailability = { canUndo: boolean; canRedo: boolean };

const selectUndoAvailability = (state: UndoStepStoreState | null): UndoAvailability => ({
    canUndo: (state?.pastSteps.length ?? 0) > 0,
    canRedo: (state?.futureSteps.length ?? 0) > 0,
});

const isSameUndoAvailability = (a: UndoAvailability, b: UndoAvailability): boolean =>
    a.canUndo === b.canUndo && a.canRedo === b.canRedo;

/** Whether undo and redo have a step; unlike `useUndoState` it does not follow the history growing. */
export const useUndoAvailability = (): UndoAvailability =>
    useStoreSelector(undoStepStore, selectUndoAvailability, isSameUndoAvailability);
