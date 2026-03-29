/**
 * Bridge between FermenterPanel UI and the audio engine.
 *
 * Maintains a cached registry of active Fermenter devices to avoid
 * O(n) track iteration on every knob change. Throttles audio engine
 * updates to avoid flooding the MessagePort during rapid knob dragging.
 */

import { updateDeviceParam } from '#/modules/AudioEngine/useCases/deviceControls';
import { getAllTracks } from '#/modules/Arrangement/useCases/trackQueries';
import { type FermenterPatch } from '../models/FermenterPatch';
import { setFermenterParam } from '../stores/fermenterStore';

type DeviceRef = { trackId: string; deviceId: string };

let cachedRefs: DeviceRef[] | null = null;
let cacheStaleTimer: ReturnType<typeof setTimeout> | null = null;

function getActiveDevices(): DeviceRef[] {
    if (cachedRefs) return cachedRefs;

    const refs: DeviceRef[] = [];
    for (const track of getAllTracks()) {
        for (const device of track.devices) {
            if (device.type === 'fermenter') {
                refs.push({ trackId: track.id, deviceId: device.id });
            }
        }
    }
    cachedRefs = refs;

    if (cacheStaleTimer) clearTimeout(cacheStaleTimer);
    cacheStaleTimer = setTimeout(() => { cachedRefs = null; }, 2000);

    return refs;
}

/**
 * Throttle map: key → pending rAF id.
 * Groups rapid param updates (e.g. knob dragging) into one update per frame.
 */
const pendingUpdates = new Map<string, number>();
const latestValues = new Map<string, number>();

function flushParam(key: string): void {
    pendingUpdates.delete(key);
    const value = latestValues.get(key);
    if (value === undefined) return;
    latestValues.delete(key);

    for (const { trackId, deviceId } of getActiveDevices()) {
        updateDeviceParam(trackId, deviceId, key, value);
    }
}

/**
 * Set a Fermenter parameter — updates the UI store immediately,
 * and throttles audio engine updates to once per animation frame.
 */
export function setFermenterParamWithAudio(key: keyof FermenterPatch, value: number): void {
    // UI store: always immediate for responsive knobs
    setFermenterParam(key, value);

    // Audio engine: throttle to rAF to avoid flooding MessagePort
    latestValues.set(key, value);
    if (!pendingUpdates.has(key)) {
        pendingUpdates.set(key, requestAnimationFrame(() => flushParam(key)));
    }
}
