import { type UndoStoreState } from '../../stores/undoStore';
import { undoTreeStore } from '../../stores/undoTree';

import { buildUndoTreeFromHistory } from './buildUndoTreeFromHistory';

/** Rebuild the enabled tree from the authoritative linear undo/redo split. */
export function rebuildUndoTreeFromHistory(history: UndoStoreState): void {
    const state = undoTreeStore.value;
    if (!state?.enabled) {
        return;
    }

    undoTreeStore.set({
        ...state,
        tree: buildUndoTreeFromHistory(history),
    });
}
