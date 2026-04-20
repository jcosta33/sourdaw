import { inject } from '#/infra/di/inject';

import { type GrinderPedal, type GrinderPedalType } from '../../models/GrinderPatch';
import { setGrinderPedalParam } from '../../stores/grinderStore';

import { grinderParamBridgeDependencies } from './grinderParamBridgeDependencies';
import { createFindDeviceRef, createFlushParam, getAudioParamKeyForPedal, paramBatcher } from './helpers';

export const setGrinderPedalParamWithAudio = inject(grinderParamBridgeDependencies)(({
    getAllTracks: getAllTracksFn,
    updateDeviceParam: updateDeviceParamFn,
    persistDeviceParam: persistDeviceParamFn,
}) => {
    const findDeviceRef = createFindDeviceRef(getAllTracksFn);
    const flushParam = createFlushParam(updateDeviceParamFn, persistDeviceParamFn);

    return function setGrinderPedalParamWithAudio(
        deviceId: string,
        isPost: boolean,
        pedalType: GrinderPedalType,
        paramKey: string,
        value: number,
        defaults: GrinderPedal
    ): void {
        setGrinderPedalParam(deviceId, isPost, pedalType, paramKey, value, defaults);

        const ref = findDeviceRef(deviceId);
        if (!ref) {
            return;
        }

        const audioKey = getAudioParamKeyForPedal(isPost, pedalType, paramKey);
        if (!audioKey) {
            return;
        }

        const compositeKey = `${deviceId}:${audioKey}`;
        paramBatcher.schedule(compositeKey, { ref, key: audioKey, value }, flushParam);
    };
});
