/**
 * Bridge between Grinder UI and the audio engine.
 * Routes kit-level and pad-level params to the WASM worklet.
 * Uses rAF throttling to avoid flooding MessagePort during knob dragging.
 */

import { getTrackStrip } from '#/modules/AudioEngine/useCases/engineAccess';
import { getAllTracks } from '#/modules/Arrangement/useCases/trackQueries';
import { updatePad } from '../stores/toasterStore';
import { type PadState } from '../models/ToasterKit';

type DeviceRef = { trackId: string; deviceId: string };

let cachedRefs: DeviceRef[] | null = null;
let cacheTimer: ReturnType<typeof setTimeout> | null = null;

function getActiveDevices(): DeviceRef[] {
    if (cachedRefs) { return cachedRefs; }
    const refs: DeviceRef[] = [];
    for (const track of getAllTracks()) {
        for (const device of track.devices) {
            if (device.type === 'toaster') {
                refs.push({ trackId: track.id, deviceId: device.id });
            }
        }
    }
    cachedRefs = refs;
    if (cacheTimer) { clearTimeout(cacheTimer); }
    cacheTimer = setTimeout(() => { cachedRefs = null; }, 2000);
    return refs;
}

// Throttling for pad-level params
const padPending = new Map<string, number>();
const padLatest = new Map<string, { pad: number; name: string; value: number }>();

function flushPadParam(cacheKey: string): void {
    padPending.delete(cacheKey);
    const entry = padLatest.get(cacheKey);
    if (!entry) { return; }
    padLatest.delete(cacheKey);

    for (const { trackId } of getActiveDevices()) {
        const strip = getTrackStrip(trackId);
        if (!strip) { continue; }
        const dn = strip.deviceNodes.find((d) => d.toasterControls && d.toasterControls.ready !== undefined);
        if (dn?.toasterControls) {
            dn.toasterControls.setPadParam(entry.pad, entry.name, entry.value);
        }
    }
}

/**
 * Update a pad parameter and forward to the audio engine via setPadParam.
 */
// Fields that are strings in the store — don't overwrite with numbers
const STRING_FIELDS = new Set(['engineType', 'name', 'color']);

export function setToasterPadParam(padIndex: number, key: keyof PadState, value: number): void {
    // Only update the store for numeric fields
    if (!STRING_FIELDS.has(key)) {
        updatePad(padIndex, { [key]: value } as Partial<PadState>);
    }

    const cacheKey = `${padIndex}_${key}`;
    padLatest.set(cacheKey, { pad: padIndex, name: key, value });
    if (!padPending.has(cacheKey)) {
        padPending.set(cacheKey, requestAnimationFrame(() => flushPadParam(cacheKey)));
    }
}

/**
 * Send engine_type directly to the worklet (bypasses rAF throttle).
 * Used by sound locks which need immediate engine swap before triggering.
 * Does NOT update the store — the pad's stored engineType remains the default.
 */
export function setPadEngineImmediate(padIndex: number, engineIdx: number): void {
    for (const { trackId } of getActiveDevices()) {
        const strip = getTrackStrip(trackId);
        if (!strip) {
            continue;
        }
        const dn = strip.deviceNodes.find((d) => d.toasterControls && d.toasterControls.ready !== undefined);
        if (dn?.toasterControls) {
            dn.toasterControls.setPadParam(padIndex, 'engine_type', engineIdx);
        }
    }
}
