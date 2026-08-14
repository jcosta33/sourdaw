import { createHandler } from '#/utils/createHandler';
import { notifyUser } from '#/utils/Notification/notifyUser';

import { setConnected } from '../../useCases/controlSurface/setConnected';
import { setProtocol } from '../../useCases/controlSurface/setProtocol';

export const handleSetControlSurface = createHandler<'setControlSurface'>({
    execute: (alpha) => {
        setProtocol(alpha.payload.protocol);
        // `connected` must never drift from `protocol` (F-4): a null protocol
        // always means disconnected, any selected protocol always means connected.
        setConnected(alpha.payload.protocol !== null);
        notifyUser(`Control surface: ${alpha.payload.protocol ?? 'disconnected'}`);
    },
    describe: () => ({ label: 'Set Control Surface Protocol' }),
    undoable: false,
});
