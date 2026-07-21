import { createRafBatcher } from '#/utils/DOM/createRafBatcher';

import { type FermenterPatch } from '../../models/FermenterPatch';
import { loadFermenterPatch } from '../../stores/fermenterStore';
import { getFermenterDependencies } from '../getFermenterDependencies';

// §33.2 — TransformPad's onPointerMove calls this on every pointermove with no
// throttle. Coalesce the full-patch engine post + full track-state persist to
// once per frame, keyed by deviceId (last-write-wins), matching the
// single-param bridge's rAF batching.
type MorphBatchEntry = { deviceId: string; patch: FermenterPatch };
const morphBatcher = createRafBatcher<MorphBatchEntry>();

function flushMorph(_compositeKey: string, entry: MorphBatchEntry): void {
    const { updateDevicePatch, persistDevicePatch, resolveEligibleDeviceWriteTarget } = getFermenterDependencies();
    const target = resolveEligibleDeviceWriteTarget(entry.deviceId);
    if (target.status !== 'eligible') {
        return;
    }

    if (updateDevicePatch) {
        updateDevicePatch(target.trackId, target.deviceId, entry.patch);
    }
    if (persistDevicePatch) {
        persistDevicePatch(target.deviceId, entry.patch);
    }
}

/**
 * Apply a morphed patch — updates both the store and the audio engine.
 */
export function applyMorphedPatch(deviceId: string, patch: FermenterPatch): void {
    const target = getFermenterDependencies().resolveEligibleDeviceWriteTarget(deviceId);
    if (target.status !== 'eligible') {
        return;
    }

    loadFermenterPatch(deviceId, patch);
    morphBatcher.schedule(deviceId, { deviceId: target.deviceId, patch }, flushMorph);
}
