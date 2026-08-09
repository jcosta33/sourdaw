import { createHandler } from '#/utils/createHandler';

import { restorePunchRegion } from '../../useCases/transportControls/restorePunchRegion';

export const handleRestorePunchRegion = createHandler<'restorePunchRegion'>({
    execute: (action) => restorePunchRegion(action.payload),
    describe: () => ({ label: 'Restore punch region' }),
    undoable: false,
});
