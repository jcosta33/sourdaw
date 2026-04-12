import { createHandler } from '#/utils/createHandler';
import { toggleUndoTree } from '../../useCases/undoTree/toggleUndoTree/toggleUndoTree';

export const handleToggleUndoTree = createHandler<'toggleUndoTree'>({
    execute: () => {
        toggleUndoTree();
    },
    describe: () => ({ label: 'Toggle Undo Tree' }),
    undoable: false,
});
