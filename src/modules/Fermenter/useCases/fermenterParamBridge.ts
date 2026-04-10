/**
 * Bridge between FermenterPanel UI and the audio engine.
 *
 * Scoped to a single device instance via deviceId. Throttles audio engine
 * updates to avoid flooding the MessagePort during rapid knob dragging.
 */

import { updateDeviceParam } from '#/modules/AudioEngine';
import { persistDeviceParam, getAllTracks } from '#/modules/Arrangement';
import { type FermenterPatch } from '../models/FermenterPatch';
import { loadFermenterPatch, setFermenterParam } from '../stores/fermenterStore';

type DeviceRef = { trackId: string; deviceId: string };

function findDeviceRef(deviceId: string): DeviceRef | null {
    for (const track of getAllTracks()) {
        if (track.devices.some((d) => d.id === deviceId)) {
            return { trackId: track.id, deviceId };
        }
    }
    return null;
}

/**
 * Throttle map: compositeKey (`${deviceId}:${paramKey}`) → pending rAF id.
 */
const pendingUpdates = new Map<string, number>();
const latestValues = new Map<string, number>();

function flushParam(deviceId: string, ref: DeviceRef, key: string): void {
    const compositeKey = `${deviceId}:${key}`;
    pendingUpdates.delete(compositeKey);
    const value = latestValues.get(compositeKey);
    if (value === undefined) return;
    latestValues.delete(compositeKey);
    updateDeviceParam(ref.trackId, ref.deviceId, key, value);
    persistDeviceParam(ref.deviceId, key, value);
}

function pushParamImmediately(ref: DeviceRef, key: string, value: number): void {
    updateDeviceParam(ref.trackId, ref.deviceId, key, value);
    persistDeviceParam(ref.deviceId, key, value);
}

/**
 * Set a Fermenter parameter — updates the UI store immediately,
 * and throttles audio engine updates to once per animation frame.
 */
export function setFermenterParamWithAudio(deviceId: string, key: keyof FermenterPatch, value: number): void {
    setFermenterParam(deviceId, key, value);

    const ref = findDeviceRef(deviceId);
    if (!ref) return;

    const compositeKey = `${deviceId}:${key}`;
    latestValues.set(compositeKey, value);
    if (!pendingUpdates.has(compositeKey)) {
        pendingUpdates.set(
            compositeKey,
            requestAnimationFrame(() => flushParam(deviceId, ref, key))
        );
    }
}

export function loadFermenterPatchWithAudio(deviceId: string, patch: FermenterPatch): void {
    loadFermenterPatch(deviceId, patch);

    const ref = findDeviceRef(deviceId);
    if (!ref) return;

    for (const [key, value] of Object.entries(patch)) {
        if (typeof value === 'number') {
            pushParamImmediately(ref, key, value);
        }
    }
}
