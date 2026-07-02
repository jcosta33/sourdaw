import { createHandler } from '#/utils/createHandler';

import { redo } from '../../useCases/undoRedo';

export const handleRedo = createHandler<'redo'>({
    execute: () => {
        return redo();
    },
    describe: () => ({ label: 'Redo' }),
    undoable: false,
});
