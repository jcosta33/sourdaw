import { createHandler } from '#/utils/createHandler';
import { disconnectPush } from '#/modules/Plugin/useCases';

export const handleDisconnectPush = createHandler<'disconnectPush'>({
    execute: () => {
        disconnectPush();
    },
    describe: () => ({ label: 'Disconnect Ableton Push' }),
    undoable: false,
});
