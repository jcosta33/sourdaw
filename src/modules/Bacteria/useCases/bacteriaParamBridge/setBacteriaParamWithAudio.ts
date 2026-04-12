import { inject } from '#/infra/di/inject';
import { type BacteriaPatch } from '../../models/BacteriaPatch';
import { setBacteriaParam } from '../../stores/bacteriaStore';
import { bacteriaParamBridgeDependencies } from './bacteriaParamBridgeDependencies';

import {
    createFindDeviceRef,
    createFlushParam,
    encodePatchValue,
    latestValues,
    pendingUpdates,
} from './helpers';

/**
 * Set a Bacteria global parameter — updates UI store immediately,
 * throttles audio engine updates to rAF.
 */
export const setBacteriaParamWithAudio = inject(bacteriaParamBridgeDependencies)(
    ({
        getAllTracks: getAllTracksFn,
        updateDeviceParam: updateDeviceParamFn,
        persistDeviceParam: persistDeviceParamFn,
    }) => {
        const findDeviceRef = createFindDeviceRef(getAllTracksFn);
        const flushParam = createFlushParam(updateDeviceParamFn, persistDeviceParamFn);
        return function setBacteriaParamWithAudio<K extends keyof BacteriaPatch>(
            deviceId: string,
            key: K,
            value: BacteriaPatch[K]
        ): void {
            setBacteriaParam(deviceId, key, value);

            const encodedValue = encodePatchValue(key, value);
            if (encodedValue === null) {return;}

            const ref = findDeviceRef(deviceId);
            if (!ref) {return;}

            const compositeKey = `${deviceId}:${key}`;
            latestValues.set(compositeKey, encodedValue);
            if (!pendingUpdates.has(compositeKey)) {
                pendingUpdates.set(
                    compositeKey,
                    requestAnimationFrame(() => flushParam(deviceId, ref, key))
                );
            }
        };
    }
);