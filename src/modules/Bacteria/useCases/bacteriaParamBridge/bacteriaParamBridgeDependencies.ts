import { persistDeviceParam, resolveEligibleDeviceWriteTarget } from '#/modules/Arrangement/stores';
import { updateDeviceParam, updateDevicePatch } from '#/modules/AudioEngine/useCases';

export const bacteriaParamBridgeDependencies = {
    updateDeviceParam,
    updateDevicePatch,
    persistDeviceParam,
    resolveEligibleDeviceWriteTarget,
} as const;
