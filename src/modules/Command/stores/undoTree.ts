/**
 * Undo tree store — branching undo history.
 * Extracted from undoTreeUseCases.ts.
 */

import { Container } from '#/helpers/DependencyInjector/Container';
import { Logger } from '#/helpers/Logger/Logger';
import { Store } from '#/helpers/Store/Store';
import { type UndoTree, createEmptyTree } from '../models/UndoTree';

const logger = Container.getInstance().get(Logger);

export type UndoTreeStoreState = {
    tree: UndoTree;
    enabled: boolean;
};

export const undoTreeStore = new Store<UndoTreeStoreState>(logger, {
    initialData: {
        tree: createEmptyTree(),
        enabled: false,
    },
});
