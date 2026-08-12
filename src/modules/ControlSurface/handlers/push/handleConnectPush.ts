import { createHandler } from '#/utils/createHandler';
import { notifyUser } from '#/utils/Notification/notifyUser';

import { connectPush } from '../../useCases/pushIntegration/connectPush';

export const handleConnectPush = createHandler<'connectPush'>({
    execute: async (alpha) => {
        await connectPush(alpha.payload.model);
        notifyUser(`Ableton Push ${alpha.payload.model === 'push2' ? '2' : '3'} connected`, 'success');
    },
    describe: () => ({ label: 'Connect Ableton Push' }),
    undoable: false,
    executionKind: 'runtime',
});
