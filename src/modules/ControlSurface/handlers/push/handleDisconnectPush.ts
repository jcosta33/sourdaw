import { createHandler } from '#/utils/createHandler';

import { disconnectPush } from '../../useCases/pushIntegration/disconnectPush';

export const handleDisconnectPush = createHandler<'disconnectPush'>({
    execute: async () => {
        await disconnectPush();
    },
    describe: () => ({ label: 'Disconnect Ableton Push' }),
    undoable: false,
    executionKind: 'runtime',
});
