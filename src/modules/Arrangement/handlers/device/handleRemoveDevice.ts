import { createHandler } from '#/utils/createHandler';

import { removeDevice } from '../../useCases/device/removeDevice';

export const handleRemoveDevice = createHandler<'removeDevice'>({
    execute: (alpha) => {
        removeDevice(alpha.payload.deviceId);
    },
    describe: () => ({ label: 'Remove device' }),
    undoable: true,
});
