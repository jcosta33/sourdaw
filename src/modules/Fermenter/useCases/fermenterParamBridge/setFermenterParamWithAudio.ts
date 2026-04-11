import { inject } from '#/infra/di/inject';
import { type FermenterPatch } from '../../models/FermenterPatch';
import { setFermenterParam } from '../../stores/fermenterStore';
import { fermenterParamBridgeDependencies } from './fermenterParamBridgeDependencies';
import type { DeviceRef, PersistDeviceParamFn, UpdateDeviceParamFn } from './helpers';
import { createFindDeviceRef } from './helpers';

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