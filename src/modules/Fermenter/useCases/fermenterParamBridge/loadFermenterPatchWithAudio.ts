import { inject } from '#/infra/di/inject';
import { type FermenterPatch } from '../../models/FermenterPatch';
import { loadFermenterPatch } from '../../stores/fermenterStore';
import { fermenterParamBridgeDependencies } from './fermenterParamBridgeDependencies';
import type { DeviceRef, PersistDeviceParamFn, UpdateDeviceParamFn } from './helpers';
import { createFindDeviceRef } from './helpers';

function createPushParamImmediately(
    updateDeviceParamFn: UpdateDeviceParamFn,
    persistDeviceParamFn: PersistDeviceParamFn
) {
    return function pushParamImmediately(ref: DeviceRef, key: string, value: number): void {
        updateDeviceParamFn(ref.trackId, ref.deviceId, key, value);
        persistDeviceParamFn(ref.deviceId, key, value);
    };
}

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