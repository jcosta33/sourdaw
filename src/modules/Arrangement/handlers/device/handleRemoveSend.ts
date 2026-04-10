import { createHandler } from '#/helpers/createHandler';
import { removeSend } from '../../useCases/device/sendManagement';

export const handleRemoveSend = createHandler<'removeSend'>({
    execute: (a) => {
        removeSend(a.payload.trackId, a.payload.busId);
    },
    describe: () => ({ label: 'Remove send' }),
    undoable: true,
});
