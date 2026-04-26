import { createHandler } from '#/utils/createHandler';

import { addDevice } from '../../useCases/device/addDevice';

export const handleAddDevice = createHandler<'addDevice'>({
    execute: (alpha) => {
        addDevice(alpha.payload.trackId, alpha.payload.deviceType);
    },
    describe: (alpha) => ({ label: `Add ${alpha.payload.deviceType}` }),
    undoable: true,
});
