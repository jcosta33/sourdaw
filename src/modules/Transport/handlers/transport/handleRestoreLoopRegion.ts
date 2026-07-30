import { createHandler } from '#/utils/createHandler';

import { restoreLoopRegion } from '../../useCases/transportControls/restoreLoopRegion';

export const handleRestoreLoopRegion = createHandler<'restoreLoopRegion'>({
    execute: (action) => {
        restoreLoopRegion(action.payload);
    },
    describe: () => ({ label: 'Restore loop region' }),
    undoable: false,
});
