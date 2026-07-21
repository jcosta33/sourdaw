import { type GlutenPatch } from '../../models/GlutenPatch';
import { setGlutenParam } from '../../stores/glutenStore';

import { createFlushHandlers } from './createFlushHandlers';
import { bridgeDeps, encodeGlutenValue, paramBatcher } from './helpers';

const { flushParam } = createFlushHandlers(bridgeDeps);

export function setGlutenParamWithAudio<Key extends keyof GlutenPatch>(
    deviceId: string,
    key: Key,
    value: GlutenPatch[Key]
): void {
    const target = bridgeDeps.resolveEligibleDeviceWriteTarget(deviceId);
    if (target.status !== 'eligible') {
        return;
    }

    setGlutenParam(deviceId, key, value);

    const encodedValue = encodeGlutenValue(key, value);
    if (encodedValue === null) {
        return;
    }

    const compositeKey = `${deviceId}:${key}`;
    paramBatcher.schedule(compositeKey, { deviceId, key, value: encodedValue }, flushParam);
}
