import { type CrustPatch } from '../../models/CrustPatch';
import { setCrustParam } from '../../stores/crustStore';

import {
    encodeCrustValue,
    findDeviceRefCrust,
    flushCrustParam,
    latestValues,
    pendingUpdates,
} from './helpers';

export function setCrustParamWithAudio<K extends keyof CrustPatch>(
    deviceId: string,
    key: K,
    value: CrustPatch[K]
): void {
    setCrustParam(key, value);

    const encodedValue = encodeCrustValue(key, value);
    if (encodedValue === null) {
        return;
    }

    const ref = findDeviceRefCrust(deviceId);
    if (!ref) {
        return;
    }

    const compositeKey = `${deviceId}:${key}`;
    latestValues.set(compositeKey, encodedValue);
    if (!pendingUpdates.has(compositeKey)) {
        pendingUpdates.set(compositeKey, requestAnimationFrame(() => flushCrustParam(deviceId, ref, key)));
    }
}