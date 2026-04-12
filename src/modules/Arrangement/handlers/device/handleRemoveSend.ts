import { createHandler } from '#/utils/createHandler';
import { removeSend } from '../../useCases/device/sendManagement/removeSend';

export const handleRemoveSend = createHandler<'removeSend'>({
    execute: (a) => {
        removeSend(a.payload.trackId, a.payload.busId);
    },
    describe: () => ({ label: 'Remove send' }),
    undoable: true,
});
