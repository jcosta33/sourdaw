import { type FermenterPatch } from '../../models/FermenterPatch';
import { loadFermenterPatch } from '../../stores/fermenterStore';
import { getFermenterDependencies } from '../fermenterDependencies';

import { createFindDeviceRef } from './helpers';
import { mapFermenterPatchToDspPatch } from './mapFermenterPatchToDspPatch';

let findDeviceRef: ReturnType<typeof createFindDeviceRef> | null = null;
function getFindDeviceRef() {
    if (!findDeviceRef) {
        findDeviceRef = createFindDeviceRef(getFermenterDependencies().getAllTracks);
    }
    return findDeviceRef;
}

export function loadFermenterPatchWithAudio(deviceId: string, patch: FermenterPatch): void {
    loadFermenterPatch(deviceId, patch);

    const ref = getFindDeviceRef()(deviceId);
    if (!ref) {
        return;
    }

    const { updateDevicePatch, persistDevicePatch } = getFermenterDependencies();
    if (updateDevicePatch) {
        updateDevicePatch(ref.trackId, ref.deviceId, mapFermenterPatchToDspPatch({ patch }));
    }
    if (persistDevicePatch) {
        persistDevicePatch(ref.deviceId, patch as Record<string, unknown>);
    }
}
