import { type GlutenPatch } from '../../models/GlutenPatch';
import { setGlutenParam } from '../../stores/glutenStore';

import { createFlushHandlers } from './createFlushHandlers';
import { bridgeDeps, encodeGlutenValue, findDeviceRefGluten, paramBatcher } from './helpers';

const { flushParam } = createFlushHandlers(bridgeDeps);

export function setGlutenParamWithAudio<Key extends keyof GlutenPatch>(
    deviceId: string,
    key: Key,
    value: GlutenPatch[Key]
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
