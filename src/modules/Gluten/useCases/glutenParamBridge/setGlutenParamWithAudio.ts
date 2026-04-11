import { type GlutenPatch } from '../../models/GlutenPatch';
import { setGlutenParam } from '../../stores/glutenStore';

import {
    encodeGlutenValue,
    findDeviceRefGluten,
    flushParam,
    latestValues,
    pendingUpdates,
} from './helpers';

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
    latestValues.set(compositeKey, encodedValue);
    if (!pendingUpdates.has(compositeKey)) {
        pendingUpdates.set(compositeKey, requestAnimationFrame(() => flushParam(deviceId, ref, key)));
    }
}