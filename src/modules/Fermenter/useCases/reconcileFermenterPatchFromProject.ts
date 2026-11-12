import { trackStore } from '#/modules/Arrangement/stores';

import { fermenterPatchesEqual, readFermenterPatchFromProjectDevice } from '../models/FermenterPatchState';
import { fermenterStore, loadFermenterPatch } from '../stores/fermenterStore';

import { cancelPendingFermenterPatchWrites } from './fermenterParamBridge/cancelPendingFermenterPatchWrites';
import { mapFermenterPatchToDspPatch } from './fermenterParamBridge/mapFermenterPatchToDspPatch';
import { getFermenterDependencies } from './getFermenterDependencies';

/** Bring the ephemeral panel and audible engine to the same committed whole patch. */
export function reconcileFermenterPatchFromProject(deviceId: string): void {
    const target = getFermenterDependencies().resolveEligibleDeviceWriteTarget(deviceId);
    if (target.status !== 'eligible') {
        return;
    }
    const owner = trackStore.value?.tracks.find((track) => track.id === target.trackId);
    const device = owner?.devices.find((candidate) => candidate.id === target.deviceId);
    if (device?.type !== 'fermenter') {
        return;
    }
    // Committed absence restores the project baseline; ordinary numeric hydration
    // may retain a live preset draft and cannot authenticate a whole-patch inverse.
    const patch = readFermenterPatchFromProjectDevice(device);
    const current = fermenterStore.value?.[deviceId]?.patch;
    if (!current || !fermenterPatchesEqual(current, patch)) {
        loadFermenterPatch(deviceId, patch);
    }
    cancelPendingFermenterPatchWrites(deviceId);
    getFermenterDependencies().updateDevicePatch?.(
        target.trackId,
        target.deviceId,
        mapFermenterPatchToDspPatch({ patch })
    );
}
