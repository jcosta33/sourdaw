import { type FermenterPatch } from '../../models/FermenterPatch';
import { loadFermenterPatch } from '../../stores/fermenterStore';
import { getFermenterDependencies } from '../getFermenterDependencies';

import { fermenterPatchBatcher, type FermenterPatchBatchEntry } from './fermenterParamBatcher';
import { mapFermenterPatchToDspPatch } from './mapFermenterPatchToDspPatch';

function flushPatch(_compositeKey: string, entry: FermenterPatchBatchEntry): void {
    const { updateDevicePatch, persistDevicePatch, resolveEligibleDeviceWriteTarget } = getFermenterDependencies();
    const target = resolveEligibleDeviceWriteTarget(entry.deviceId);
    if (target.status !== 'eligible') {
        return;
    }

    if (updateDevicePatch) {
        updateDevicePatch(target.trackId, target.deviceId, mapFermenterPatchToDspPatch({ patch: entry.patch }));
    }
    if (persistDevicePatch) {
        persistDevicePatch(target.deviceId, entry.patch);
    }
}

export function loadFermenterPatchWithAudio(deviceId: string, patch: FermenterPatch): void {
    const target = getFermenterDependencies().resolveEligibleDeviceWriteTarget(deviceId);
    if (target.status !== 'eligible') {
        return;
    }

    loadFermenterPatch(deviceId, patch);
    fermenterPatchBatcher.schedule(deviceId, { deviceId: target.deviceId, patch }, flushPatch);
}
