import { getTrackStrip } from '#/modules/AudioEngine/useCases';

import { type PadState } from '../../models/ToasterKit';
import { updatePad } from '../../stores/toasterStore';

import { findDeviceRef } from './helpers';

const padPending = new Map<string, number>();
const padLatest = new Map<string, { pad: number; name: string; value: number }>();

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
    const dn = strip.deviceNodes.find((d) => d.toasterControls && d.toasterControls.ready !== undefined);
    if (dn?.toasterControls) {
        dn.toasterControls.setPadParam(entry.pad, entry.name, entry.value);
    }
}

export function setToasterPadParam(deviceId: string, padIndex: number, key: keyof PadState, value: number): void {
    if (!STRING_FIELDS.has(key)) {
        updatePad(padIndex, { [key]: value } as Partial<PadState>);
    }

    const ref = findDeviceRef(deviceId);
    if (!ref) {
        return;
    }

    const cacheKey = `${deviceId}_${padIndex}_${key}`;
    padLatest.set(cacheKey, { pad: padIndex, name: key, value });
    if (!padPending.has(cacheKey)) {
        padPending.set(
            cacheKey,
            requestAnimationFrame(() => flushPadParam(cacheKey, ref.trackId))
        );
    }
}
