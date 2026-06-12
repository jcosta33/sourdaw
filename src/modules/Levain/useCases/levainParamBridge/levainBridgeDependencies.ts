import { trackStore, type Track, persistDeviceParam } from '#/modules/Arrangement/stores';

import { autoLoadLevainSamples } from '../autoLoadSamples';

function getAllTracks(): Track[] {
    return trackStore.value?.tracks ?? [];
}

export const levainBridgeDependencies = {
    getAllTracks,
    persistDeviceParam,
    autoLoadLevainSamples,
} as const;
