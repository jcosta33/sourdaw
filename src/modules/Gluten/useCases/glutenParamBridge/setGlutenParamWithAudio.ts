import { type GlutenPatch } from '../../models/GlutenPatch';
import { setGlutenParam } from '../../stores/glutenStore';

import { encodeGlutenValue, findDeviceRefGluten, flushParam, paramBatcher } from './helpers';

export function setGlutenParamWithAudio<K extends keyof GlutenPatch>(
    deviceId: string,
    key: K,
    value: GlutenPatch[K]
): void {
    setGlutenParam(deviceId, key, value);

    const encodedValue = encodeGlutenValue(key, value);
    if (encodedValue === null) {
        return;
    }

    const ref = findDeviceRefGluten(deviceId);
    if (!ref) {
        return;
    }

    const compositeKey = `${deviceId}:${key}`;
    paramBatcher.schedule(compositeKey, { ref, key, value: encodedValue }, flushParam);
}
