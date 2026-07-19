import { createRafBatcher } from '#/utils/DOM/createRafBatcher';

import { type FermenterPatch } from '../../models/FermenterPatch';
import { loadFermenterPatch } from '../../stores/fermenterStore';
import { getFermenterDependencies } from '../getFermenterDependencies';

import { createFindDeviceRef } from './helpers';
import { mapFermenterPatchToDspPatch } from './mapFermenterPatchToDspPatch';

import type { DeviceRef } from './helpers';

// §33.2 — Coalesce full-patch engine + persistence writes to once per frame.
// A morph/macro-pad drag calls this at pointer-event rate; without batching it
// posts a full patch to the worklet and clones the whole track-state tree per
// pointermove. Keyed by deviceId so rapid writes to one device collapse to the
// latest patch on the next animation frame (last-write-wins), like the
// single-param bridge (setFermenterParamWithAudio).
type PatchBatchEntry = { ref: DeviceRef; patch: FermenterPatch };
const patchBatcher = createRafBatcher<PatchBatchEntry>();

let findDeviceRef: ReturnType<typeof createFindDeviceRef> | null = null;
function getFindDeviceRef() {
    if (!findDeviceRef) {
        findDeviceRef = createFindDeviceRef(getFermenterDependencies().getAllTracks);
    }
    return findDeviceRef;
}

function flushPatch(_compositeKey: string, entry: PatchBatchEntry): void {
    const { updateDevicePatch, persistDevicePatch } = getFermenterDependencies();
    if (updateDevicePatch) {
        updateDevicePatch(entry.ref.trackId, entry.ref.deviceId, mapFermenterPatchToDspPatch({ patch: entry.patch }));
    }
    if (persistDevicePatch) {
        persistDevicePatch(entry.ref.deviceId, entry.patch);
    }
}

export function loadFermenterPatchWithAudio(deviceId: string, patch: FermenterPatch): void {
    loadFermenterPatch(deviceId, patch);

    const ref = getFindDeviceRef()(deviceId);
    if (!ref) {
        return;
    }

    patchBatcher.schedule(deviceId, { ref, patch }, flushPatch);
}
