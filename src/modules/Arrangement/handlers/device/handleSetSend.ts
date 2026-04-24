import { createHandler } from '#/utils/createHandler';

import { setSend } from '../../useCases/device/sendManagement/setSend';

export const handleSetSend = createHandler<'setSend'>({
    execute: (alpha) => {
        setSend(alpha.payload.trackId, alpha.payload.busId, alpha.payload.level);
    },
    describe: () => ({ label: 'Set send level' }),
    undoable: true,
});
