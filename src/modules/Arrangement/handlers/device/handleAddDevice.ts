import { createHandler } from '#/utils/createHandler';

import { addDevice } from '../../useCases/device/addDevice';

export const handleAddDevice = createHandler<'addDevice'>({
    execute: (a) => {
        addDevice(a.payload.trackId, a.payload.deviceType);
    },
    describe: (a) => ({ label: `Add ${a.payload.deviceType}` }),
    undoable: true,
});
