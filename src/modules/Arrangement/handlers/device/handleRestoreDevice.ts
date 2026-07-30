import { createHandler } from '#/utils/createHandler';

import { restoreDevice } from '../../useCases/device/restoreDevice';

export const handleRestoreDevice = createHandler<'restoreDevice'>({
    execute: (action) => {
        const outcome = restoreDevice(action.payload);
        if (outcome === 'conflict') {
            return { status: 'conflict' };
        }
        return { status: 'written' };
    },
    describe: () => ({ label: 'Restore device' }),
    undoable: false,
});
