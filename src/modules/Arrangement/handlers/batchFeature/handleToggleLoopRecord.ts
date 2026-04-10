import { createHandler } from '#/helpers/createHandler';
import { toggleRecord } from '#/modules/Transport';

export const handleToggleLoopRecord = createHandler<'toggleLoopRecord'>({
    execute: (a) => {
        toggleRecord(a.payload.slotId);
    },
    describe: () => ({ label: 'Toggle Loop Record' }),
    undoable: false,
});
