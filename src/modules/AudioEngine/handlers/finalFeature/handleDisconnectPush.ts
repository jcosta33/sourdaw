import { createHandler } from '#/helpers/createHandler';
import { disconnectPush } from '#/modules/Plugin/useCases';

export const handleDisconnectPush = createHandler<'disconnectPush'>({
    execute: () => {
        disconnectPush();
    },
    describe: () => ({ label: 'Disconnect Ableton Push' }),
    undoable: false,
});
