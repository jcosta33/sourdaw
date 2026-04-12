import { createHandler } from '#/utils/createHandler';
import { notifyUser } from '#/utils/Notification/notifyUser';
import { connectPush } from '#/modules/Plugin/useCases';

export const handleConnectPush = createHandler<'connectPush'>({
    execute: (a) => {
        connectPush(a.payload.model);
        notifyUser(`Ableton Push ${a.payload.model === 'push2' ? '2' : '3'} connected`, 'success');
    },
    describe: () => ({ label: 'Connect Ableton Push' }),
    undoable: false,
});
