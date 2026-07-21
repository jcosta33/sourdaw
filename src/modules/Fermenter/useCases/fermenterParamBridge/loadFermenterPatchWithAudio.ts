import { createRafBatcher } from '#/utils/DOM/createRafBatcher';

import { type FermenterPatch } from '../../models/FermenterPatch';
import { loadFermenterPatch } from '../../stores/fermenterStore';
import { getFermenterDependencies } from '../getFermenterDependencies';

import { mapFermenterPatchToDspPatch } from './mapFermenterPatchToDspPatch';

// §33.2 — Coalesce full-patch engine + persistence writes to once per frame.
// A morph/macro-pad drag calls this at pointer-event rate; without batching it
// posts a full patch to the worklet and clones the whole track-state tree per
// pointermove. Keyed by deviceId so rapid writes to one device collapse to the
// latest patch on the next animation frame (last-write-wins), like the
// single-param bridge (setFermenterParamWithAudio).
type PatchBatchEntry = { deviceId: string; patch: FermenterPatch };
const patchBatcher = createRafBatcher<PatchBatchEntry>();

function flushPatch(_compositeKey: string, entry: PatchBatchEntry): void {
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
    patchBatcher.schedule(deviceId, { deviceId: target.deviceId, patch }, flushPatch);
}
