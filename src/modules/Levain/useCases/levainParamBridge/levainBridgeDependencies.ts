import { persistDeviceParam, getAllTracks } from '#/modules/Arrangement/useCases';

import { autoLoadLevainSamples } from '../autoLoadSamples';

export const levainBridgeDependencies = {
    getAllTracks,
    persistDeviceParam,
    autoLoadLevainSamples,
} as const;
