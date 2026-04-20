import { createHandler } from '#/utils/createHandler';

import { bypassDevice } from '../../useCases/device/bypassDevice';

export const handleBypassDevice = createHandler<'bypassDevice'>({
    execute: (a) => {
        bypassDevice(a.payload.deviceId, a.payload.bypassed);
    },
    describe: (a) => ({ label: a.payload.bypassed ? 'Bypass device' : 'Enable device' }),
    undoable: true,
});
