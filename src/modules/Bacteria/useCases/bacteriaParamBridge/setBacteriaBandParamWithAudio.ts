import { inject } from '#/infra/di/inject';

import { type BacteriaPatch } from '../../models/BacteriaPatch';
import { setBacteriaBandParam } from '../../stores/bacteriaStore';

import { bacteriaParamBridgeDependencies } from './bacteriaParamBridgeDependencies';
import { createFindDeviceRef, createFlushParam, encodePatchValue, paramBatcher } from './helpers';

/**
 * Set a Bacteria per-band parameter — updates UI store immediately,
 * throttles audio engine updates to rAF with a band-prefixed key.
 */
export const setBacteriaBandParamWithAudio = inject(bacteriaParamBridgeDependencies)(({
    getAllTracks: getAllTracksFn,
    updateDeviceParam: updateDeviceParamFn,
    persistDeviceParam: persistDeviceParamFn,
}) => {
    const findDeviceRef = createFindDeviceRef(getAllTracksFn);
    const flushParam = createFlushParam(updateDeviceParamFn, persistDeviceParamFn);
    return function setBacteriaBandParamWithAudio<K extends keyof BacteriaPatch['bands'][0]>(
        deviceId: string,
        bandIndex: number,
        key: K,
        value: BacteriaPatch['bands'][0][K]
    ): void {
        setBacteriaBandParam(deviceId, bandIndex, key, value);

        const prefixedKey = `band${bandIndex}_${key}`;
        const encodedValue = encodePatchValue(String(key), value);
        if (encodedValue === null) {
            return;
        }

        const ref = findDeviceRef(deviceId);
        if (!ref) {
            return;
        }

        const compositeKey = `${deviceId}:${prefixedKey}`;
        paramBatcher.schedule(compositeKey, { ref, key: prefixedKey, value: encodedValue }, flushParam);
    };
});
