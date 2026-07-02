import { createRafBatcher } from '#/utils/DOM/createRafBatcher';

import { type FermenterPatch } from '../../models/FermenterPatch';
import { loadFermenterPatch } from '../../stores/fermenterStore';
import { createFindDeviceRef } from '../fermenterParamBridge/helpers';
import { getFermenterDependencies } from '../getFermenterDependencies';

import type { DeviceRef } from '../fermenterParamBridge/helpers';

// §33.2 — TransformPad's onPointerMove calls this on every pointermove with no
// throttle. Coalesce the full-patch engine post + full track-state persist to
// once per frame, keyed by deviceId (last-write-wins), matching the
// single-param bridge's rAF batching.
type MorphBatchEntry = { ref: DeviceRef; patch: FermenterPatch };
const morphBatcher = createRafBatcher<MorphBatchEntry>();

let findDeviceRef: ReturnType<typeof createFindDeviceRef> | null = null;
function getFindDeviceRef() {
    if (!findDeviceRef) {
        findDeviceRef = createFindDeviceRef(getFermenterDependencies().getAllTracks);
    }
    return findDeviceRef;
}

function flushMorph(_compositeKey: string, entry: MorphBatchEntry): void {
    const { updateDevicePatch, persistDevicePatch } = getFermenterDependencies();
    if (updateDevicePatch) {
        updateDevicePatch(entry.ref.trackId, entry.ref.deviceId, entry.patch as Record<string, unknown>);
    }
    if (persistDevicePatch) {
        persistDevicePatch(entry.ref.deviceId, entry.patch as Record<string, unknown>);
    }
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

    morphBatcher.schedule(deviceId, { ref, patch }, flushMorph);
}
