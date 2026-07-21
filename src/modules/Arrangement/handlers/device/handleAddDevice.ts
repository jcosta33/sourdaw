import { createHandler } from '#/utils/createHandler';

import { addDevice } from '../../useCases/device/addDevice';
import { toHandlerExecutionResult } from '../toHandlerExecutionResult';

export const handleAddDevice = createHandler<'addDevice'>({
    execute: (alpha) => {
        return toHandlerExecutionResult(addDevice(alpha.payload.trackId, alpha.payload.deviceType) !== null);
    },
    describe: (alpha) => ({ label: `Add ${alpha.payload.deviceType}` }),
    undoable: true,
});
