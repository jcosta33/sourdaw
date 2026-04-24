import { createHandler } from '#/utils/createHandler';

import { bypassDevice } from '../../useCases/device/bypassDevice';

export const handleBypassDevice = createHandler<'bypassDevice'>({
    execute: (alpha) => {
        bypassDevice(alpha.payload.deviceId, alpha.payload.bypassed);
    },
    describe: (alpha) => ({ label: alpha.payload.bypassed ? 'Bypass device' : 'Enable device' }),
    undoable: true,
});
