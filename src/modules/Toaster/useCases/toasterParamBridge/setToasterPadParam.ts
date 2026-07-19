import { getTrackStrip } from '#/modules/AudioEngine/useCases';

import { type PadState } from '../../models/ToasterKit';
import { updatePad } from '../../stores/toasterStore';

import { findDeviceRef } from './helpers';
import { padLatest, padPending } from './toasterPadParamQueue';

const STRING_FIELDS = new Set(['engineType', 'name', 'color']);

function flushPadParam(cacheKey: string, trackId: string): void {
    padPending.delete(cacheKey);
    const entry = padLatest.get(cacheKey);
    if (!entry) {
        return;
    }
    padLatest.delete(cacheKey);

    const strip = getTrackStrip(trackId);
    if (!strip) {
        return;
    }
    const toasterControls = strip.deviceNodes.find(
        (data) => data.toasterControls?.ready !== undefined
    )?.toasterControls;
    if (toasterControls) {
        toasterControls.setPadParam(entry.pad, entry.name, entry.value);
    }
}

export function setToasterPadParam(deviceId: string, padIndex: number, key: keyof PadState, value: number): void {
    if (!STRING_FIELDS.has(key)) {
        updatePad(deviceId, padIndex, { [key]: value });
    }

    const ref = findDeviceRef(deviceId);
    if (!ref) {
        return;
    }

    const cacheKey = `${deviceId}_${padIndex}_${key}`;
    padLatest.set(cacheKey, { deviceId, pad: padIndex, name: key, value });
    if (!padPending.has(cacheKey)) {
        const rafId = requestAnimationFrame(() => flushPadParam(cacheKey, ref.trackId));
        padPending.set(cacheKey, { deviceId, rafId });
    }
}
