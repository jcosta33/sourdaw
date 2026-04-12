import { createHandler } from '#/utils/createHandler';
import { updateDeviceParam } from '#/modules/AudioEngine/useCases';
import { setDeviceParameter } from '../../useCases/device/setDeviceParameter/setDeviceParameter';
import { getTrackStoreState } from '../../useCases/getTrackStoreState';

export const handleSetDeviceParameter = createHandler<'setDeviceParameter'>({
    execute: (a) => {
        setDeviceParameter(a.payload.deviceId, a.payload.paramId, a.payload.value);
        const ownerTrackId =
            getTrackStoreState()?.tracks.find((t) => t.devices.some((d) => d.id === a.payload.deviceId))?.id ?? '';
        updateDeviceParam(ownerTrackId, a.payload.deviceId, a.payload.paramId, a.payload.value);
    },
    describe: (a) => ({ label: `Set ${a.payload.paramId}` }),
    undoable: true,
});
