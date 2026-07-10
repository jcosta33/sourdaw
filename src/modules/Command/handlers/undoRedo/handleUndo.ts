import { createHandler } from '#/utils/createHandler';

import { undo } from '../../useCases/undo';

export const handleUndo = createHandler<'undo'>({
    execute: () => {
        return undo();
    },
    describe: () => ({ label: 'Undo' }),
    undoable: false,
});
