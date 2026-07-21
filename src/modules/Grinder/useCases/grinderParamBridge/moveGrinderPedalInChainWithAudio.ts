import { inject } from '#/infra/di/inject';

import { type GrinderPedalType } from '../../models/GrinderPatch';
import { moveGrinderPedalInChain } from '../../stores/grinderStore';

import { getPedalOrderAudioEntries } from './getPedalOrderAudioEntries';
import { grinderParamBridgeDependencies } from './grinderParamBridgeDependencies';

export const moveGrinderPedalInChainWithAudio = inject(grinderParamBridgeDependencies)(({
    updateDeviceParam: update_device_param_fn,
    persistDeviceParam: persist_device_param_fn,
    resolveEligibleDeviceWriteTarget: resolve_eligible_device_write_target_fn,
}) => {
    return function moveGrinderPedalInChainWithAudio(
        deviceId: string,
        isPost: boolean,
        pedalType: GrinderPedalType,
        direction: 'left' | 'right'
    ): void {
        const target = resolve_eligible_device_write_target_fn(deviceId);
        if (target.status !== 'eligible') {
            return;
        }

        const next_patch = moveGrinderPedalInChain(deviceId, isPost, pedalType, direction);
        if (!next_patch) {
            return;
        }

        const chain_key = isPost ? next_patch.postPedals : next_patch.prePedals;
        for (const entry of getPedalOrderAudioEntries(isPost, chain_key)) {
            update_device_param_fn(target.trackId, target.deviceId, entry.key, entry.value);
            persist_device_param_fn(target.deviceId, entry.key, entry.value);
        }
    };
});
