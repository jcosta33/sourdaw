import {
    trackStore,
    type Track,
    persistDeviceParam,
    resolveEligibleDeviceWriteTarget,
} from '#/modules/Arrangement/stores';
import { updateDeviceParam, updateDevicePatch } from '#/modules/AudioEngine/useCases';

function getAllTracks(): Track[] {
    return trackStore.value?.tracks ?? [];
}

export const grinderParamBridgeDependencies = {
    getAllTracks,
    updateDeviceParam,
    updateDevicePatch,
    persistDeviceParam,
    resolveEligibleDeviceWriteTarget,
} as const;
