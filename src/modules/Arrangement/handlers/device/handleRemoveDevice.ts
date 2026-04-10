import { createHandler } from '#/helpers/createHandler';
import { removeDevice } from '../../useCases/device/removeDevice';

export const handleRemoveDevice = createHandler<'removeDevice'>({
    execute: (a) => {
        removeDevice(a.payload.deviceId);
    },
    describe: () => ({ label: 'Remove device' }),
    undoable: true,
});
