import { createHandler } from '#/utils/createHandler';

import { setDeviceParameter } from '../../useCases/device/setDeviceParameter/setDeviceParameter';
import { toHandlerExecutionResult } from '../toHandlerExecutionResult';

export const handleSetDeviceParameter = createHandler<'setDeviceParameter'>({
    execute: (alpha) => {
        return toHandlerExecutionResult(
            setDeviceParameter(alpha.payload.deviceId, alpha.payload.paramId, alpha.payload.value)
        );
    },
    describe: (alpha) => ({ label: `Set ${alpha.payload.paramId}` }),
    undoable: true,
});
