import { createHandler } from '#/utils/createHandler';

import { redo } from '../../useCases/redo';

export const handleRedo = createHandler<'redo'>({
    execute: () => {
        return redo();
    },
    describe: () => ({ label: 'Redo' }),
    undoable: false,
});
