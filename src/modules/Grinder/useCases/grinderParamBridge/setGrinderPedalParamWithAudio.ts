import { inject } from '#/infra/di/inject';

import { type GrinderPedal, type GrinderPedalType } from '../../models/GrinderPatch';
import { setGrinderPedalParam } from '../../stores/grinderStore';

import { createFlushParam } from './createFlushParam';
import { getAudioParamKeyForPedal } from './getAudioParamKeyForPedal';
import { grinderParamBridgeDependencies } from './grinderParamBridgeDependencies';
import { paramBatcher } from './helpers';

export const setGrinderPedalParamWithAudio = inject(grinderParamBridgeDependencies)(({
    updateDeviceParam: updateDeviceParamFn,
    persistDeviceParam: persistDeviceParamFn,
    resolveEligibleDeviceWriteTarget: resolveEligibleDeviceWriteTargetFn,
}) => {
    const flushParam = createFlushParam({
        updateDeviceParamFn,
        persistDeviceParamFn,
        resolveEligibleDeviceWriteTargetFn,
    });

    return function setGrinderPedalParamWithAudio(
        deviceId: string,
        isPost: boolean,
        pedalType: GrinderPedalType,
        paramKey: string,
        value: number,
        defaults: GrinderPedal
    ): void {
        const target = resolveEligibleDeviceWriteTargetFn(deviceId);
        if (target.status !== 'eligible') {
            return;
        }

        setGrinderPedalParam(deviceId, isPost, pedalType, paramKey, value, defaults);

        const audioKey = getAudioParamKeyForPedal(isPost, pedalType, paramKey);
        if (!audioKey) {
            return;
        }

        const compositeKey = `${deviceId}:${audioKey}`;
        paramBatcher.schedule(compositeKey, { deviceId: target.deviceId, key: audioKey, value }, flushParam);
    };
});
