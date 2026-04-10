import { createHandler } from '#/helpers/createHandler';
import { setSend } from '../../useCases/device/sendManagement';

export const handleAddSend = createHandler<'addSend'>({
    execute: (a) => {
        setSend(a.payload.trackId, a.payload.busId, a.payload.level);
    },
    describe: () => ({ label: 'Add send' }),
    undoable: true,
});
