import { autoLoadLevainSamples } from '../autoLoadSamples';
import { persistDeviceParam, getAllTracks } from '#/modules/Arrangement/useCases';

export const levainBridgeDependencies = {
    getAllTracks,
    persistDeviceParam,
    autoLoadLevainSamples,
} as const;