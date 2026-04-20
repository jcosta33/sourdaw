import { createHandler } from '#/utils/createHandler';

import { toggleLoop } from '../../useCases/transportControls/toggleLoop';

export const handleToggleLoop = createHandler<'toggleLoop'>({
    execute: () => {
        toggleLoop();
    },
    describe: () => ({ label: 'Toggle loop' }),
    undoable: true,
});
