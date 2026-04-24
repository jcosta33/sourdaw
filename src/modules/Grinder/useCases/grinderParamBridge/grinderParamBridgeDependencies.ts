import { trackStore, type Track, persistDeviceParam } from '#/modules/Arrangement/stores';
import { updateDeviceParam } from '#/modules/AudioEngine/useCases';

function getAllTracks(): Track[] {
    return trackStore.value?.tracks ?? [];
}

export const grinderParamBridgeDependencies = {
    getAllTracks,
    updateDeviceParam,
    persistDeviceParam,
} as const;
