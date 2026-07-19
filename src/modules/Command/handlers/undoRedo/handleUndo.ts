import { createHandler } from '#/utils/createHandler';

import { undoUnderMutation } from '../../useCases/undoUnderMutation';

export const handleUndo = createHandler<'undo'>({
    execute: () => {
        return undoUnderMutation();
    },
    describe: () => ({ label: 'Undo' }),
    undoable: false,
});
