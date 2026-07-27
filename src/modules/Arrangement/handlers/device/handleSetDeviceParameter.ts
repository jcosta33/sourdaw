import { createHandler } from '#/utils/createHandler';

import { setDeviceParameter } from '../../useCases/device/setDeviceParameter/setDeviceParameter';
import { getTrackStoreState } from '../../useCases/getTrackStoreState';
import { toHandlerExecutionResult } from '../toHandlerExecutionResult';

export const handleSetDeviceParameter = createHandler<'setDeviceParameter'>({
    execute: (alpha) => {
        return toHandlerExecutionResult(
            setDeviceParameter(alpha.payload.deviceId, alpha.payload.paramId, alpha.payload.value)
        );
    },
    isNoop: (action) =>
        getTrackStoreState()
            ?.tracks.flatMap((track) => track.devices)
            .find((device) => device.id === action.payload.deviceId)?.parameterValues[action.payload.paramId] ===
        action.payload.value,
    describe: (alpha) => {
        const prev = getTrackStoreState()
            ?.tracks.flatMap((time) => time.devices)
            .find((data) => data.id === alpha.payload.deviceId);
        const previousValue = prev?.parameterValues[alpha.payload.paramId];
        return {
            label: `Set ${alpha.payload.paramId}`,
            // A param absent from the store cannot be restored to "absent" —
            // only snapshot real previous values.
            inverseAction:
                prev && typeof previousValue === 'number'
                    ? {
                          type: 'setDeviceParameter',
                          payload: { deviceId: prev.id, paramId: alpha.payload.paramId, value: previousValue },
                      }
                    : null,
        };
    },
    undoable: true,
});
