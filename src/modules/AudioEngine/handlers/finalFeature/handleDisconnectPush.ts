import { disconnectPush } from '#/modules/Plugin/useCases';
import { createHandler } from '#/utils/createHandler';

export const handleDisconnectPush = createHandler<'disconnectPush'>({
    execute: () => {
        disconnectPush();
    },
    describe: () => ({ label: 'Disconnect Ableton Push' }),
    undoable: false,
});
