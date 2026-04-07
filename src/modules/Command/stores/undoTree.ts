/**
 * Undo tree store — branching undo history.
 * Extracted from undoTreeUseCases.ts.
 */

import { createStore } from '#/infra/store/createStore';
import { type UndoTree, createEmptyTree } from '../models/UndoTree';

export type UndoTreeStoreState = {
    tree: UndoTree;
    enabled: boolean;
};

export const undoTreeStore = createStore<UndoTreeStoreState>({
    initialData: {
        tree: createEmptyTree(),
        enabled: false,
    },
});
