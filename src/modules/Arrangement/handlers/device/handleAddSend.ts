import { createHandler } from '#/utils/createHandler';
import { setSend } from '../../useCases/device/sendManagement/setSend';

export const handleAddSend = createHandler<'addSend'>({
    execute: (a) => {
        setSend(a.payload.trackId, a.payload.busId, a.payload.level);
    },
    describe: () => ({ label: 'Add send' }),
    undoable: true,
});
