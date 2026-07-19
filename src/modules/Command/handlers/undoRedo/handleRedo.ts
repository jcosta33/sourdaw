import { createHandler } from '#/utils/createHandler';

import { redoUnderMutation } from '../../useCases/redoUnderMutation';

export const handleRedo = createHandler<'redo'>({
    execute: () => {
        return redoUnderMutation();
    },
    describe: () => ({ label: 'Redo' }),
    undoable: false,
});
