import { getAllTracks, persistDeviceParam } from '#/modules/Arrangement/useCases';
import { updateDeviceParam } from '#/modules/AudioEngine/useCases';

export const grinderParamBridgeDependencies = {
    getAllTracks,
    updateDeviceParam,
    persistDeviceParam,
} as const;