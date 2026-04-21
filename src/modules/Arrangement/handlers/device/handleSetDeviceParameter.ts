import { updateDeviceParam } from '#/modules/AudioEngine/useCases';
import { createHandler } from '#/utils/createHandler';

import { setDeviceParameter } from '../../useCases/device/setDeviceParameter/setDeviceParameter';
import { getTrackStoreState } from '../../useCases/getTrackStoreState';

export const handleSetDeviceParameter = createHandler<'setDeviceParameter'>({
    execute: (alpha) => {
        setDeviceParameter(alpha.payload.deviceId, alpha.payload.paramId, alpha.payload.value);
        const ownerTrackId =
            getTrackStoreState()?.tracks.find((time) => time.devices.some((data) => data.id === alpha.payload.deviceId))
                ?.id ?? '';
        updateDeviceParam(ownerTrackId, alpha.payload.deviceId, alpha.payload.paramId, alpha.payload.value);
    },
    describe: (alpha) => ({ label: `Set ${alpha.payload.paramId}` }),
    undoable: true,
});
