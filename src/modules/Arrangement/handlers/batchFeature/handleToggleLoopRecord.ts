import { toggleRecord } from '#/modules/Transport/useCases';
import { createHandler } from '#/utils/createHandler';

export const handleToggleLoopRecord = createHandler<'toggleLoopRecord'>({
    execute: (a) => {
        toggleRecord(a.payload.slotId);
    },
    describe: () => ({ label: 'Toggle Loop Record' }),
    undoable: false,
});
