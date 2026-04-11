import { createHandler } from '#/helpers/createHandler';
import { setSend } from '../../useCases/device/sendManagement/setSend';

export const handleSetSend = createHandler<'setSend'>({
    execute: (a) => {
        setSend(a.payload.trackId, a.payload.busId, a.payload.level);
    },
    describe: () => ({ label: 'Set send level' }),
    undoable: true,
});
