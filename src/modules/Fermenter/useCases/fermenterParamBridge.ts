/**
 * Bridge between FermenterPanel UI and the audio engine.
 *
 * Scoped to a single device instance via deviceId. Throttles audio engine
 * updates to avoid flooding the MessagePort during rapid knob dragging.
 */

import { inject } from '#/infra/di/inject';
import { updateDeviceParam } from '#/modules/AudioEngine/useCases/deviceControls';
import { persistDeviceParam } from '#/modules/Arrangement/useCases/device/setDeviceParameter';
import { getAllTracks } from '#/modules/Arrangement/useCases/getAllTracks';
import { type FermenterPatch } from '../models/FermenterPatch';
import { loadFermenterPatch, setFermenterParam } from '../stores/fermenterStore';

type DeviceRef = { trackId: string; deviceId: string };

type GetAllTracksFn = typeof getAllTracks;
type UpdateDeviceParamFn = typeof updateDeviceParam;
type PersistDeviceParamFn = typeof persistDeviceParam;

function createFindDeviceRef(getAllTracksFn: GetAllTracksFn) {
    return function findDeviceRef(deviceId: string): DeviceRef | null {
        for (const track of getAllTracksFn()) {
            if (track.devices.some((d) => d.id === deviceId)) {
                return { trackId: track.id, deviceId };
            }
        }
        return null;
    };
}

/**
 * Throttle map: compositeKey (`${deviceId}:${paramKey}`) → pending rAF id.
 */
const pendingUpdates = new Map<string, number>();
const latestValues = new Map<string, number>();

function createFlushParam(
    updateDeviceParamFn: UpdateDeviceParamFn,
    persistDeviceParamFn: PersistDeviceParamFn
) {
    return function flushParam(deviceId: string, ref: DeviceRef, key: string): void {
        const compositeKey = `${deviceId}:${key}`;
        pendingUpdates.delete(compositeKey);
        const value = latestValues.get(compositeKey);
        if (value === undefined) return;
        latestValues.delete(compositeKey);
        updateDeviceParamFn(ref.trackId, ref.deviceId, key, value);
        persistDeviceParamFn(ref.deviceId, key, value);
    };
}

function createPushParamImmediately(
    updateDeviceParamFn: UpdateDeviceParamFn,
    persistDeviceParamFn: PersistDeviceParamFn
) {
    return function pushParamImmediately(ref: DeviceRef, key: string, value: number): void {
        updateDeviceParamFn(ref.trackId, ref.deviceId, key, value);
        persistDeviceParamFn(ref.deviceId, key, value);
    };
}

export const fermenterParamBridgeDependencies = {
    getAllTracks,
    updateDeviceParam,
    persistDeviceParam,
} as const;

/**
 * Set a Fermenter parameter — updates the UI store immediately,
 * and throttles audio engine updates to once per animation frame.
 */
export const setFermenterParamWithAudio = inject(fermenterParamBridgeDependencies)(
    ({
        getAllTracks: getAllTracksFn,
        updateDeviceParam: updateDeviceParamFn,
        persistDeviceParam: persistDeviceParamFn,
    }) => {
        const findDeviceRef = createFindDeviceRef(getAllTracksFn);
        const flushParam = createFlushParam(updateDeviceParamFn, persistDeviceParamFn);
        return function setFermenterParamWithAudio(deviceId: string, key: keyof FermenterPatch, value: number): void {
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
        };
    }
);

export const loadFermenterPatchWithAudio = inject(fermenterParamBridgeDependencies)(
    ({
        getAllTracks: getAllTracksFn,
        updateDeviceParam: updateDeviceParamFn,
        persistDeviceParam: persistDeviceParamFn,
    }) => {
        const findDeviceRef = createFindDeviceRef(getAllTracksFn);
        const pushParamImmediately = createPushParamImmediately(updateDeviceParamFn, persistDeviceParamFn);
        return function loadFermenterPatchWithAudio(deviceId: string, patch: FermenterPatch): void {
            loadFermenterPatch(deviceId, patch);

            const ref = findDeviceRef(deviceId);
            if (!ref) return;

            for (const [key, value] of Object.entries(patch)) {
                if (typeof value === 'number') {
                    pushParamImmediately(ref, key, value);
                }
            }
        };
    }
);
