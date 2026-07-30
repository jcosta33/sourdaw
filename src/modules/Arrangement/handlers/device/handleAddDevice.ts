import { createHandler } from '#/utils/createHandler';

import { addDevice } from '../../useCases/device/addDevice';
import { toHandlerExecutionResult } from '../toHandlerExecutionResult';

type AddDeviceAction = { payload: { deviceId?: string } };

function ensureDeviceId(action: AddDeviceAction): string {
    if (action.payload.deviceId) {
        return action.payload.deviceId;
    }
    const deviceId = `device-${crypto.randomUUID().slice(0, 8)}`;
    action.payload.deviceId = deviceId;
    return deviceId;
}

export const handleAddDevice = createHandler<'addDevice'>({
    execute: (action) => {
        const deviceId = ensureDeviceId(action);
        return toHandlerExecutionResult(
            addDevice(action.payload.trackId, action.payload.deviceType, undefined, deviceId) !== null
        );
    },
    describe: (action) => {
        const deviceId = ensureDeviceId(action);
        return {
            label: `Add ${action.payload.deviceType}`,
            inverseAction: { type: 'removeDevice', payload: { deviceId } },
        };
    },
    requiresAbortCompensation: true,
    undoable: true,
});
