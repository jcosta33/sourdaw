import { persistDeviceParam, resolveEligibleDeviceWriteTarget } from '#/modules/Arrangement/stores';
import { sendNativeLiveMidiControl, writeNativeBuiltinParameters } from '#/modules/AudioEngine/useCases';

import { setLoadedMicPositions } from '../../stores/levainStore';
import { autoLoadLevainSamples } from '../autoLoadSamples';

export const levainBridgeDependencies = {
    persistDeviceParam,
    autoLoadLevainSamples,
    setLoadedMicPositions,
    resolveEligibleDeviceWriteTarget,
    writeNativeBuiltinParameters,
    sendNativeLiveMidiControl,
} as const;
