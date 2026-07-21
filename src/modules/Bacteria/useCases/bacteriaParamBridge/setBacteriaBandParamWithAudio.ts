import { inject } from '#/infra/di/inject';

import { type BacteriaPatch } from '../../models/BacteriaPatch';
import { getBacteriaState, setBacteriaBandParam } from '../../stores/bacteriaStore';

import { bacteriaParamBridgeDependencies } from './bacteriaParamBridgeDependencies';
import { createFlushParam } from './createFlushParam';
import { encodePatchValue, paramBatcher } from './helpers';

/**
 * Set a Bacteria per-band parameter — updates UI store immediately,
 * throttles audio engine updates to rAF with a band-prefixed key.
 */
export const setBacteriaBandParamWithAudio = inject(bacteriaParamBridgeDependencies)(({
    updateDeviceParam: updateDeviceParamFn,
    persistDeviceParam: persistDeviceParamFn,
    resolveEligibleDeviceWriteTarget: resolveEligibleDeviceWriteTargetFn,
}) => {
    const flushParam = createFlushParam(updateDeviceParamFn, persistDeviceParamFn, resolveEligibleDeviceWriteTargetFn);
    return function setBacteriaBandParamWithAudio<Key extends keyof BacteriaPatch['bands'][0]>(
        deviceId: string,
        bandIndex: number,
        key: Key,
        value: BacteriaPatch['bands'][0][Key]
    ): void {
        const target = resolveEligibleDeviceWriteTargetFn(deviceId);
        if (target.status !== 'eligible') {
            return;
        }

        setBacteriaBandParam(deviceId, bandIndex, key, value);

        // Mirror the store's bounds guard before encoding/scheduling an engine
        // write — an out-of-range bandIndex is a no-op in the store, so its
        // band-prefixed param must never reach the audio engine either.
        const bands = getBacteriaState(deviceId).patch.bands;
        if (bandIndex < 0 || bandIndex >= bands.length) {
            return;
        }

        const prefixedKey = `band${bandIndex}_${key}`;
        const encodedValue = encodePatchValue(String(key), value);
        if (encodedValue === null) {
            return;
        }

        const compositeKey = `${deviceId}:${prefixedKey}`;
        paramBatcher.schedule(
            compositeKey,
            { deviceId: target.deviceId, key: prefixedKey, value: encodedValue },
            flushParam
        );
    };
});
