import { inject } from '#/infra/di/inject';
import { createFindDeviceRef } from '#/utils/createFindDeviceRef';

import { type GrinderMic } from '../../models/GrinderPatch';
import { setGrinderMicParam } from '../../stores/grinderStore';

import { createFlushParam } from './createFlushParam';
import { grinderParamBridgeDependencies } from './grinderParamBridgeDependencies';
import { paramBatcher } from './helpers';

export const setGrinderMicParamWithAudio = inject(grinderParamBridgeDependencies)(({
    getAllTracks: getAllTracksFn,
    updateDeviceParam: updateDeviceParamFn,
    persistDeviceParam: persistDeviceParamFn,
}) => {
    const findDeviceRef = createFindDeviceRef(getAllTracksFn);
    const flushParam = createFlushParam({ updateDeviceParamFn, persistDeviceParamFn });

    return function setGrinderMicParamWithAudio<Key extends keyof GrinderMic>(
        deviceId: string,
        micIndex: 1 | 2,
        key: Key,
        value: number
    ): void {
        // Note: GrinderMic values are all numeric in the model except 'type' and 'enabled'
        // But they are passed as number to the audio engine
        let finalValue: unknown = value;
        if (key === 'enabled') {
            finalValue = value >= 0.5;
        } else if (key === 'type') {
            const types = ['dynamic', 'ribbon', 'condenser', 'room'] as const;
            finalValue = types[Math.floor(value)] ?? 'dynamic';
        }

        setGrinderMicParam(deviceId, micIndex, key, finalValue as GrinderMic[Key]);

        const ref = findDeviceRef(deviceId);
        if (!ref) {
            return;
        }

        const audioKey = `mic${micIndex}${key.charAt(0).toUpperCase()}${key.slice(1)}`;
        const compositeKey = `${deviceId}:${audioKey}`;
        paramBatcher.schedule(compositeKey, { ref, key: audioKey, value }, flushParam);
    };
});
