import { type FermenterPatch } from '../../models/FermenterPatch';
import { loadFermenterPatch } from '../../stores/fermenterStore';
import { getFermenterDependencies } from '../fermenterDependencies';
import { createFindDeviceRef } from '../fermenterParamBridge/helpers';

let findDeviceRef: ReturnType<typeof createFindDeviceRef> | null = null;
function getFindDeviceRef() {
    if (!findDeviceRef) {
        findDeviceRef = createFindDeviceRef(getFermenterDependencies().getAllTracks);
    }
    return findDeviceRef;
}

/**
 * Apply a morphed patch — updates both the store and the audio engine.
 */
export function applyMorphedPatch(deviceId: string, patch: FermenterPatch): void {
    loadFermenterPatch(deviceId, patch);

    const ref = getFindDeviceRef()(deviceId);
    if (!ref) {
        return;
    }

    const { updateDevicePatch, persistDevicePatch } = getFermenterDependencies();
    if (updateDevicePatch) {
        updateDevicePatch(ref.trackId, ref.deviceId, patch as Record<string, unknown>);
    }
    if (persistDevicePatch) {
        persistDevicePatch(ref.deviceId, patch as Record<string, unknown>);
    }
}