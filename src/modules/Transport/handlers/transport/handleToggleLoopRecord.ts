import { createHandler } from '#/utils/createHandler';

import { toggleRecord } from '../../useCases/loopStation/toggleRecord';

export const handleToggleLoopRecord = createHandler<'toggleLoopRecord'>({
    execute: (action) => {
        toggleRecord(action.payload.slotId);
    },
    describe: () => ({ label: 'Toggle Loop Record' }),
    undoable: false,
});
