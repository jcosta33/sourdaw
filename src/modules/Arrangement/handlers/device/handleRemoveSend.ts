import { createHandler } from '#/utils/createHandler';

import { removeSend } from '../../useCases/device/sendManagement/removeSend';

export const handleRemoveSend = createHandler<'removeSend'>({
    execute: (alpha) => {
        removeSend(alpha.payload.trackId, alpha.payload.busId);
    },
    describe: () => ({ label: 'Remove send' }),
    undoable: true,
});
