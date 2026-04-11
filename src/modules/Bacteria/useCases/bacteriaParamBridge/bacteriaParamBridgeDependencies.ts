import { getAllTracks, persistDeviceParam } from '#/modules/Arrangement/useCases';
import { updateDeviceParam } from '#/modules/AudioEngine/useCases';

export const bacteriaParamBridgeDependencies = {
    getAllTracks,
    updateDeviceParam,
    persistDeviceParam,
} as const;