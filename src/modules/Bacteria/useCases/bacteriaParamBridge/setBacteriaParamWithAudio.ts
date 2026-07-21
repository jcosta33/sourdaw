import { inject } from '#/infra/di/inject';

import { type BacteriaPatch } from '../../models/BacteriaPatch';
import { setBacteriaParam } from '../../stores/bacteriaStore';

import { bacteriaParamBridgeDependencies } from './bacteriaParamBridgeDependencies';
import { createFlushParam } from './createFlushParam';
import { encodePatchValue, paramBatcher } from './helpers';

/**
 * Set a Bacteria global parameter — updates UI store immediately,
 * throttles audio engine updates to rAF.
 */
export const setBacteriaParamWithAudio = inject(bacteriaParamBridgeDependencies)(({
    updateDeviceParam: updateDeviceParamFn,
    persistDeviceParam: persistDeviceParamFn,
    resolveEligibleDeviceWriteTarget: resolveEligibleDeviceWriteTargetFn,
}) => {
    const flushParam = createFlushParam(updateDeviceParamFn, persistDeviceParamFn, resolveEligibleDeviceWriteTargetFn);
    return function setBacteriaParamWithAudio<Key extends keyof BacteriaPatch>(
        deviceId: string,
        key: Key,
        value: BacteriaPatch[Key]
    ): void {
        const target = resolveEligibleDeviceWriteTargetFn(deviceId);
        if (target.status !== 'eligible') {
            return;
        }

        setBacteriaParam(deviceId, key, value);

        const encodedValue = encodePatchValue(key, value);
        if (encodedValue === null) {
            return;
        }

        const compositeKey = `${deviceId}:${key}`;
        paramBatcher.schedule(compositeKey, { deviceId: target.deviceId, key, value: encodedValue }, flushParam);
    };
});
