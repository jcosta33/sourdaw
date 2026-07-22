import { createHandler } from '#/utils/createHandler';

import { removeDevice } from '../../useCases/device/removeDevice';

export const handleRemoveDevice = createHandler<'removeDevice'>({
    execute: (alpha) => {
        const outcome = removeDevice(alpha.payload.deviceId);
        if (outcome === 'conflict') {
            return { status: 'conflict' };
        }
        if (outcome === 'missing') {
            return { status: 'no-write' };
        }
        return { status: 'written' };
    },
    describe: () => ({ label: 'Remove device' }),
    undoable: true,
});
