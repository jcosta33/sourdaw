import { type CrustPatch } from '../../models/CrustPatch';
import { setCrustParam } from '../../stores/crustStore';

import {
    encodeCrustValue,
    findDeviceRefCrust,
    flushCrustParam,
    paramBatcher,
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
    paramBatcher.schedule(compositeKey, { ref, key, value: encodedValue }, flushCrustParam);
}