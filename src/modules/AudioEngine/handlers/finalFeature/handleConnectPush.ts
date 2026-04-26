import { connectPush } from '#/modules/Plugin/useCases';
import { createHandler } from '#/utils/createHandler';
import { notifyUser } from '#/utils/Notification/notifyUser';

export const handleConnectPush = createHandler<'connectPush'>({
    execute: (alpha) => {
        connectPush(alpha.payload.model);
        notifyUser(`Ableton Push ${alpha.payload.model === 'push2' ? '2' : '3'} connected`, 'success');
    },
    describe: () => ({ label: 'Connect Ableton Push' }),
    undoable: false,
});
