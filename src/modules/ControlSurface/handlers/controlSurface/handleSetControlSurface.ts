import { createHandler } from '#/utils/createHandler';
import { notifyUser } from '#/utils/Notification/notifyUser';

import { setProtocol } from '../../useCases/controlSurface/setProtocol';

export const handleSetControlSurface = createHandler<'setControlSurface'>({
    execute: (alpha) => {
        setProtocol(alpha.payload.protocol);
        notifyUser(`Control surface: ${alpha.payload.protocol ?? 'disconnected'}`);
    },
    describe: () => ({ label: 'Set Control Surface Protocol' }),
    undoable: false,
});
