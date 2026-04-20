import { inject } from '#/infra/di/inject';

import { type GrinderMic } from '../../models/GrinderPatch';
import { setGrinderMicParam } from '../../stores/grinderStore';

import { grinderParamBridgeDependencies } from './grinderParamBridgeDependencies';
import { createFindDeviceRef, createFlushParam, paramBatcher } from './helpers';

export const setGrinderMicParamWithAudio = inject(grinderParamBridgeDependencies)(({
    getAllTracks: getAllTracksFn,
    updateDeviceParam: updateDeviceParamFn,
    persistDeviceParam: persistDeviceParamFn,
}) => {
    const findDeviceRef = createFindDeviceRef(getAllTracksFn);
    const flushParam = createFlushParam(updateDeviceParamFn, persistDeviceParamFn);

    return function setGrinderMicParamWithAudio<K extends keyof GrinderMic>(
        deviceId: string,
        micIndex: 1 | 2,
        key: K,
        value: number
    ): void {
        // Note: GrinderMic values are all numeric in the model except 'type' and 'enabled'
        // But they are passed as number to the audio engine
        setGrinderMicParam(deviceId, micIndex, key, value as any);

        const ref = findDeviceRef(deviceId);
        if (!ref) {
            return;
        }

        const audioKey = `mic${micIndex}${key.charAt(0).toUpperCase()}${key.slice(1)}`;
        const compositeKey = `${deviceId}:${audioKey}`;
        paramBatcher.schedule(compositeKey, { ref, key: audioKey, value }, flushParam);
    };
});
