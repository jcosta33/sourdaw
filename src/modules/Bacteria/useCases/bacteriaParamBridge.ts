/**
 * Bacteria parameter bridge — throttles UI updates to audio engine.
 *
 * Same rAF-throttled pattern as glutenParamBridge.
 */
import { updateDeviceParam } from '#/modules/AudioEngine/useCases/deviceControls';
import { persistDeviceParam } from '#/modules/Arrangement/useCases/device/setDeviceParameter';
import { getAllTracks } from '#/modules/Arrangement/useCases/trackQueries';
import { type BacteriaPatch } from '../models/BacteriaPatch';
import { setBacteriaParam, setBacteriaBandParam } from '../stores/bacteriaStore';

type DeviceRef = { trackId: string; deviceId: string };

let cachedRefs: DeviceRef[] | null = null;
let cacheStaleTimer: ReturnType<typeof setTimeout> | null = null;

function getActiveDevices(): DeviceRef[] {
    if (cachedRefs) {
        return cachedRefs;
    }

    const refs: DeviceRef[] = [];
    for (const track of getAllTracks()) {
        for (const device of track.devices) {
            if (device.type === 'bacteria') {
                refs.push({ trackId: track.id, deviceId: device.id });
            }
        }
    }
    cachedRefs = refs;

    if (cacheStaleTimer) {
        clearTimeout(cacheStaleTimer);
    }
    cacheStaleTimer = setTimeout(() => {
        cachedRefs = null;
    }, 2000);

    return refs;
}

const pendingUpdates = new Map<string, number>();
const latestValues = new Map<string, number>();

function flushParam(key: string): void {
    pendingUpdates.delete(key);
    const value = latestValues.get(key);
    if (value === undefined) {
        return;
    }
    latestValues.delete(key);

    for (const { trackId, deviceId } of getActiveDevices()) {
        updateDeviceParam(trackId, deviceId, key, value);
        persistDeviceParam(deviceId, key, value);
    }
}

/**
 * Set a Bacteria global parameter — updates UI store immediately,
 * throttles audio engine updates to rAF.
 */
export function setBacteriaParamWithAudio<K extends keyof BacteriaPatch>(key: K, value: number): void {
    setBacteriaParam(key, value as BacteriaPatch[K]);

    latestValues.set(key, value);
    if (!pendingUpdates.has(key)) {
        pendingUpdates.set(
            key,
            requestAnimationFrame(() => flushParam(key))
        );
    }
}

/**
 * Set a Bacteria per-band parameter — updates UI store immediately,
 * throttles audio engine updates to rAF with a band-prefixed key.
 */
export function setBacteriaBandParamWithAudio<K extends keyof BacteriaPatch['bands'][0]>(
    bandIndex: number,
    key: K,
    value: number
): void {
    setBacteriaBandParam(bandIndex, key, value as BacteriaPatch['bands'][0][K]);

    const prefixedKey = `band${bandIndex}_${key}`;
    latestValues.set(prefixedKey, value);
    if (!pendingUpdates.has(prefixedKey)) {
        pendingUpdates.set(
            prefixedKey,
            requestAnimationFrame(() => flushParam(prefixedKey))
        );
    }
}
