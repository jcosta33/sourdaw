/**
 * Bridge between Grinder UI and the audio engine.
 * Routes kit-level and pad-level params to the WASM worklet.
 * Uses rAF throttling to avoid flooding MessagePort during knob dragging.
 */

import { audioEngine } from '#/modules/AudioEngine/repositories/createWebAudioEngine';
import { getAllTracks } from '#/modules/Arrangement/repositories/track/queries';
import { updatePad, updateKitParam } from '../stores/grinderStore';
import { type PadState, type GrinderKit } from '../models/GrinderKit';

type DeviceRef = { trackId: string; deviceId: string };

let cachedRefs: DeviceRef[] | null = null;
let cacheTimer: ReturnType<typeof setTimeout> | null = null;

export function invalidateGrinderCache(): void {
    cachedRefs = null;
}

function getActiveDevices(): DeviceRef[] {
    if (cachedRefs) { return cachedRefs; }
    const refs: DeviceRef[] = [];
    for (const track of getAllTracks()) {
        for (const device of track.devices) {
            if (device.type === 'grinder') {
                refs.push({ trackId: track.id, deviceId: device.id });
            }
        }
    }
    cachedRefs = refs;
    if (cacheTimer) { clearTimeout(cacheTimer); }
    cacheTimer = setTimeout(() => { cachedRefs = null; }, 2000);
    return refs;
}

// Throttling for kit-level params
const kitPending = new Map<string, number>();
const kitLatest = new Map<string, number>();

function flushKitParam(key: string): void {
    kitPending.delete(key);
    const value = kitLatest.get(key);
    if (value === undefined) { return; }
    kitLatest.delete(key);

    for (const { trackId } of getActiveDevices()) {
        const strip = audioEngine.getTrackStrip(trackId);
        if (!strip) { continue; }
        const dn = strip.deviceNodes.find((d) => d.grinderControls?.ready);
        if (dn?.grinderControls) {
            dn.grinderControls.setParam(key, value);
        }
    }
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
        const strip = audioEngine.getTrackStrip(trackId);
        if (!strip) { continue; }
        const dn = strip.deviceNodes.find((d) => d.grinderControls?.ready);
        if (dn?.grinderControls) {
            dn.grinderControls.setPadParam(entry.pad, entry.name, entry.value);
        }
    }
}

/**
 * Update a kit-level parameter and forward to the audio engine.
 */
export function setGrinderKitParam(key: keyof GrinderKit, value: number): void {
    updateKitParam(key, value);
    kitLatest.set(key, value);
    if (!kitPending.has(key)) {
        kitPending.set(key, requestAnimationFrame(() => flushKitParam(key)));
    }
}

/**
 * Update a pad parameter and forward to the audio engine via setPadParam.
 */
// Fields that are strings in the store — don't overwrite with numbers
const STRING_FIELDS = new Set(['engineType', 'name', 'color']);

export function setGrinderPadParam(padIndex: number, key: keyof PadState, value: number): void {
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
