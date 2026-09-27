import {
    trackStore,
    type Track,
    persistDeviceParam,
    resolveEligibleDeviceWriteTarget,
} from '#/modules/Arrangement/stores';
import { sendNativeLiveMidiControl, writeNativeBuiltinParameters } from '#/modules/AudioEngine/useCases';

import { setLoadedMicPositions } from '../../stores/levainStore';
import { autoLoadLevainSamples } from '../autoLoadSamples';

function getAllTracks(): Track[] {
    return trackStore.value?.tracks ?? [];
}

export const levainBridgeDependencies = {
    getAllTracks,
    persistDeviceParam,
    autoLoadLevainSamples,
    setLoadedMicPositions,
    resolveEligibleDeviceWriteTarget,
    writeNativeBuiltinParameters,
    sendNativeLiveMidiControl,
} as const;
