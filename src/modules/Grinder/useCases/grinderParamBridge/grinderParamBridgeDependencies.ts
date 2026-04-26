import { getAllTracks, persistDeviceParam } from '#/modules/Arrangement/useCases';
import { updateDeviceParam, updateDevicePatch } from '#/modules/AudioEngine/useCases';

export const grinderParamBridgeDependencies = {
    getAllTracks,
    updateDeviceParam,
    updateDevicePatch,
    persistDeviceParam,
} as const;
