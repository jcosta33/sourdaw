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
    const dn = strip.deviceNodes.find((data) => data.toasterControls && data.toasterControls.ready !== undefined);
    if (dn?.toasterControls) {
        dn.toasterControls.setPadParam(entry.pad, entry.name, entry.value);
    }
}

/**
 * Cancel any rAF coalescing in flight for a device and drop its queued
 * pad-param writes. Called on device teardown so a frame scheduled before
 * destroy() cannot fire after the device is gone (no resurrect, no stray
 * worklet write to a detached node).
 */
export function cancelPendingToasterPadParams(deviceId: string): void {
    const prefix = `${deviceId}_`;
    for (const [cacheKey, rafId] of padPending) {
        if (cacheKey.startsWith(prefix)) {
            cancelAnimationFrame(rafId);
            padPending.delete(cacheKey);
            padLatest.delete(cacheKey);
        }
    }
}

export function setToasterPadParam(deviceId: string, padIndex: number, key: keyof PadState, value: number): void {
    if (!STRING_FIELDS.has(key)) {
        updatePad(deviceId, padIndex, { [key]: value } as Partial<PadState>);
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
