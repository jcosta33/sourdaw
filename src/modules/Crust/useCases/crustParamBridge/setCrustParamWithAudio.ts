import { type CrustPatch } from '../../models/CrustPatch';
import { setCrustParam } from '../../stores/crustStore';

import { encodeCrustValue, findDeviceRefCrust, flushCrustParam, paramBatcher } from './helpers';

export function setCrustParamWithAudio<Key extends keyof CrustPatch>(
    deviceId: string,
    key: Key,
    value: CrustPatch[Key]
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
