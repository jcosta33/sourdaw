import { createHandler } from '#/utils/createHandler';

import { undo } from '../../useCases/undo';

export const handleUndo = createHandler<'undo'>({
    execute: async () => {
        await undo();
    },
    describe: () => ({ label: 'Undo' }),
    undoable: false,
});
