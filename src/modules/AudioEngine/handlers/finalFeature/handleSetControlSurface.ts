import { createHandler } from '#/helpers/createHandler';
import { notifyUser } from '#/helpers/Notification/notifyUser';
import { setProtocol } from '../../useCases/controlSurface/setProtocol';

export const handleSetControlSurface = createHandler<'setControlSurface'>({
    execute: (a) => {
        setProtocol(a.payload.protocol);
        notifyUser(`Control surface: ${a.payload.protocol ?? 'disconnected'}`);
    },
    describe: () => ({ label: 'Set Control Surface Protocol' }),
    undoable: false,
});
