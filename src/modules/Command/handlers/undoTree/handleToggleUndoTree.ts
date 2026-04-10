import { createHandler } from '#/helpers/createHandler';
import { toggleUndoTree } from '../../useCases/undoTree/toggleUndoTree';

export const handleToggleUndoTree = createHandler<'toggleUndoTree'>({
    execute: () => {
        toggleUndoTree();
    },
    describe: () => ({ label: 'Toggle Undo Tree' }),
    undoable: false,
});
