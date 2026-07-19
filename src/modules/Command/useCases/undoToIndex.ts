import { undoStore } from '../stores/undoStore';

import { collectUndoHistoryUnits } from './collectUndoHistoryUnits';
import { redoUnderMutation } from './redoUnderMutation';
import { runUndoRedoExclusive } from './undoRedo';
import { undoUnderMutation } from './undoUnderMutation';

export function undoToIndex(targetUnitId: string): Promise<void> {
    return runUndoRedoExclusive(async () => {
        for (;;) {
            const state = undoStore.value;
            if (!state) {
                return;
            }
            const pastUnits = collectUndoHistoryUnits(state.past);
            const currentUnitId = pastUnits.at(-1)?.id;
            if (targetUnitId === currentUnitId) {
                return;
            }

            const before = `${state.past.length}:${state.future.length}:${currentUnitId ?? 'root'}`;
            if (pastUnits.some((unit) => unit.id === targetUnitId)) {
                await undoUnderMutation();
            } else if (collectUndoHistoryUnits(state.future).some((unit) => unit.id === targetUnitId)) {
                await redoUnderMutation();
            } else {
                return;
            }

            const current = undoStore.value;
            const afterHead = current ? collectUndoHistoryUnits(current.past).at(-1)?.id : undefined;
            const after = current
                ? `${current.past.length}:${current.future.length}:${afterHead ?? 'root'}`
                : 'unavailable';
            if (after === before) {
                return;
            }
        }
    });
}
