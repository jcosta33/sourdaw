import { createHandler } from '#/utils/createHandler';

import { restoreDevice } from '../../useCases/device/restoreDevice';
import { getTrackStoreState } from '../../useCases/getTrackStoreState';

export const handleRestoreDevice = createHandler<'restoreDevice'>({
    execute: (action) => {
        if (action.payload.expectedDeviceIds) {
            const track = getTrackStoreState()?.tracks.find((candidate) => candidate.id === action.payload.trackId);
            const currentDeviceIds = track?.devices.map((device) => device.id);
            if (
                !currentDeviceIds ||
                currentDeviceIds.length !== action.payload.expectedDeviceIds.length ||
                action.payload.expectedDeviceIds.some((deviceId, index) => currentDeviceIds[index] !== deviceId)
            ) {
                return { status: 'conflict' };
            }
        }
        const outcome = restoreDevice(action.payload);
        if (outcome === 'conflict') {
            return { status: 'conflict' };
        }
        return { status: 'written' };
    },
    describe: () => ({ label: 'Restore device' }),
    undoable: false,
});
