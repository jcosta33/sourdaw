import { inject } from '#/infra/di/inject';

import { getBacteriaState, setBacteriaSnapshotValues } from '../../stores/bacteriaStore';

import { bacteriaParamBridgeDependencies } from './bacteriaParamBridgeDependencies';
import { flattenPatchParams } from './flattenPatchParams';

/** The four morph corners, in the order the pad and the patch store them. */
export const MORPH_CORNER_COUNT = 4;

/**
 * Capture the device's current flattened patch values into one morph corner.
 *
 * The write is the owning module's store mutation — the same route every other
 * panel control takes — so the component never touches `bacteriaStore`
 * directly. Like `snapshots` itself (see BacteriaPatch.ts) the captured
 * corners are UI/persistence metadata: nothing here reaches the engine, and
 * the pad's next move is what interpolates them into scalar param writes.
 */
export const captureBacteriaSnapshot = inject(bacteriaParamBridgeDependencies)(
    ({ resolveEligibleDeviceWriteTarget: resolveEligibleDeviceWriteTargetFn }) =>
        function captureBacteriaSnapshot(deviceId: string, cornerIndex: number): void {
            const target = resolveEligibleDeviceWriteTargetFn(deviceId);
            if (target.status !== 'eligible') {
                return;
            }
            if (cornerIndex < 0 || cornerIndex >= MORPH_CORNER_COUNT) {
                return;
            }

            setBacteriaSnapshotValues(deviceId, cornerIndex, flattenPatchParams(getBacteriaState(deviceId).patch));
        }
);
