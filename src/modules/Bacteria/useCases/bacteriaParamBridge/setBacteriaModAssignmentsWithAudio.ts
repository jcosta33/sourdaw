import { inject } from '#/infra/di/inject';

import { mapBacteriaModAssignments } from '../../models/BacteriaModulationIds';
import { type BacteriaModAssignment } from '../../models/BacteriaPatch';
import { setBacteriaModAssignments } from '../../stores/bacteriaStore';

import { bacteriaParamBridgeDependencies } from './bacteriaParamBridgeDependencies';

/**
 * Replace the device's whole modulation-assignment routing.
 *
 * Every UI gesture that changes the table — the dock's add and remove, undo,
 * redo, a preset load — arrives here, because the engine's assignment table has
 * no per-entry removal: its side is a wholesale replacement (clear-then-re-add
 * inside the worklet), so the store and the engine always describe the same
 * routing after one call. The table leaves through the patch door
 * ({@link updateDevicePatch}) rather than the scalar `(paramId, value)` door,
 * which cannot express a structured row.
 */
export const setBacteriaModAssignmentsWithAudio = inject(bacteriaParamBridgeDependencies)(({
    updateDevicePatch: updateDevicePatchFn,
    resolveEligibleDeviceWriteTarget: resolveEligibleDeviceWriteTargetFn,
}) => {
    return function setBacteriaModAssignmentsWithAudio(deviceId: string, assignments: BacteriaModAssignment[]): void {
        const target = resolveEligibleDeviceWriteTargetFn(deviceId);
        if (target.status !== 'eligible') {
            return;
        }

        setBacteriaModAssignments(deviceId, assignments);

        const mapped = mapBacteriaModAssignments(assignments);
        if (!mapped) {
            return;
        }
        updateDevicePatchFn(target.trackId, target.deviceId, { modAssignments: mapped });
    };
});
