import { createHandler } from '#/helpers/createHandler';
import { disconnectPush } from '#/modules/Plugin';

export const handleDisconnectPush = createHandler<'disconnectPush'>({
    execute: () => {
        disconnectPush();
    },
    describe: () => ({ label: 'Disconnect Ableton Push' }),
    undoable: false,
});
