import { type FermenterPatch } from '../../models/FermenterPatch';
import { loadFermenterPatch } from '../../stores/fermenterStore';
import { getAllTracks, persistDeviceParam } from '#/modules/Arrangement/useCases';
import { updateDeviceParam } from '#/modules/AudioEngine/useCases';
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

const findDeviceRef = createFindDeviceRef(getAllTracks);
const pushParamImmediately = createPushParamImmediately(
    updateDeviceParam,
    persistDeviceParam
);

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