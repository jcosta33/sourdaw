import { createHandler } from '#/utils/createHandler';

import { bypassDevice } from '../../useCases/device/bypassDevice';
import { getTrackStoreState } from '../../useCases/getTrackStoreState';
import { toHandlerExecutionResult } from '../toHandlerExecutionResult';

export const handleBypassDevice = createHandler<'bypassDevice'>({
    execute: (alpha) => {
        return toHandlerExecutionResult(bypassDevice(alpha.payload.deviceId, alpha.payload.bypassed));
    },
    isNoop: (action) =>
        getTrackStoreState()
            ?.tracks.flatMap((track) => track.devices)
            .find((device) => device.id === action.payload.deviceId)?.bypassed === action.payload.bypassed,
    describe: (alpha) => {
        // Re-bypassing an already-bypassed device is a forward no-op, so the
        // inverse restores the captured pre-state instead of negating the
        // payload. The use case forwards both directions to the live engine.
        const prev = getTrackStoreState()
            ?.tracks.flatMap((time) => time.devices)
            .find((data) => data.id === alpha.payload.deviceId);
        return {
            label: alpha.payload.bypassed ? 'Bypass device' : 'Enable device',
            inverseAction: prev
                ? { type: 'bypassDevice', payload: { deviceId: prev.id, bypassed: prev.bypassed } }
                : null,
        };
    },
    undoable: true,
});
