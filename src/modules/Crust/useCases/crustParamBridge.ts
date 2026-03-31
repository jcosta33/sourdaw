/**
 * Crust parameter bridge — throttles UI updates to the audio engine.
 * Same rAF-throttled pattern as glutenParamBridge.
 */
import { updateDeviceParam } from '#/modules/AudioEngine/useCases/deviceControls';
import { persistDeviceParam } from '#/modules/Arrangement/useCases/device/setDeviceParameter';
import { getAllTracks } from '#/modules/Arrangement/useCases/trackQueries';
import { type CrustPatch } from '../models/CrustPatch';
import { setCrustParam } from '../stores/crustStore';

type DeviceRef = { trackId: string; deviceId: string };

let cachedRefs: DeviceRef[] | null = null;
let cacheStaleTimer: ReturnType<typeof setTimeout> | null = null;

function getActiveDevices(): DeviceRef[] {
    if (cachedRefs) { return cachedRefs; }

    const refs: DeviceRef[] = [];
    for (const track of getAllTracks()) {
        for (const device of track.devices) {
            if (device.type === 'crust') {
                refs.push({ trackId: track.id, deviceId: device.id });
            }
        }
    }
    cachedRefs = refs;

    if (cacheStaleTimer) { clearTimeout(cacheStaleTimer); }
    cacheStaleTimer = setTimeout(() => { cachedRefs = null; }, 2000);

    return refs;
}

const pendingUpdates = new Map<string, number>();
const latestValues = new Map<string, number>();

function flushParam(key: string): void {
    pendingUpdates.delete(key);
    const value = latestValues.get(key);
    if (value === undefined) { return; }
    latestValues.delete(key);

    for (const { trackId, deviceId } of getActiveDevices()) {
        updateDeviceParam(trackId, deviceId, key, value);
        persistDeviceParam(deviceId, key, value);
    }
}

/**
 * Set a Crust parameter — updates the UI store immediately,
 * throttles audio engine updates to rAF.
 */
export function setCrustParamWithAudio<K extends keyof CrustPatch>(key: K, value: number): void {
    setCrustParam(key, value as CrustPatch[K]);

    latestValues.set(key, value);
    if (!pendingUpdates.has(key)) {
        pendingUpdates.set(key, requestAnimationFrame(() => flushParam(key)));
    }
}
