import { createHandler } from '#/utils/createHandler';

import { undo } from '../../useCases/undoRedo';

export const handleUndo = createHandler<'undo'>({
    execute: () => {
        return undo();
    },
    describe: () => ({ label: 'Undo' }),
    undoable: false,
});
