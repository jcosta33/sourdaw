import { inject } from '#/infra/di/inject';

import { type GrinderPedalType } from '../../models/GrinderPatch';
import { moveGrinderPedalInChain } from '../../stores/grinderStore';

import { grinderParamBridgeDependencies } from './grinderParamBridgeDependencies';
import { createFindDeviceRef, getPedalOrderAudioEntries } from './helpers';

export const moveGrinderPedalInChainWithAudio = inject(grinderParamBridgeDependencies)(({
    getAllTracks: get_all_tracks_fn,
    updateDeviceParam: update_device_param_fn,
    persistDeviceParam: persist_device_param_fn,
}) => {
    const find_device_ref = createFindDeviceRef(get_all_tracks_fn);

    return function moveGrinderPedalInChainWithAudio(
        deviceId: string,
        isPost: boolean,
        pedalType: GrinderPedalType,
        direction: 'left' | 'right'
    ): void {
        const next_patch = moveGrinderPedalInChain(deviceId, isPost, pedalType, direction);
        if (!next_patch) {
            return;
        }

        const ref = find_device_ref(deviceId);
        if (!ref) {
            return;
        }

        const chain_key = isPost ? next_patch.postPedals : next_patch.prePedals;
        for (const entry of getPedalOrderAudioEntries(isPost, chain_key)) {
            update_device_param_fn(ref.trackId, ref.deviceId, entry.key, entry.value);
            persist_device_param_fn(ref.deviceId, entry.key, entry.value);
        }
    };
});
