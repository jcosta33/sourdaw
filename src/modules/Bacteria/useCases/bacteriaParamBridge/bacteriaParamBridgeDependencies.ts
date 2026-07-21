import {
    trackStore,
    type Track,
    persistDeviceParam,
    resolveEligibleDeviceWriteTarget,
} from '#/modules/Arrangement/stores';
import { updateDeviceParam } from '#/modules/AudioEngine/useCases';

function getAllTracks(): Track[] {
    return trackStore.value?.tracks ?? [];
}

export const bacteriaParamBridgeDependencies = {
    getAllTracks,
    updateDeviceParam,
    persistDeviceParam,
    resolveEligibleDeviceWriteTarget,
} as const;
