import { inject } from '#/infra/di/inject';

import { mapBacteriaModAssignments } from '../../models/BacteriaModulationIds';
import { type BacteriaModAssignment } from '../../models/BacteriaPatch';

import { bacteriaParamBridgeDependencies } from './bacteriaParamBridgeDependencies';

/**
 * Push a modulation-routing table to the live engine for one device, without
 * touching the session store.
 *
 * The engine half of {@link setBacteriaModAssignmentsWithAudio}, extracted so a
 * caller that already holds a store-shaped table — the panel's own project
 * hydration replacing the store's table from the document's `deviceState`
 * chunk — can push the same rows to the live worklet without re-writing the
 * store it just read the rows from (#4756). Ineligible targets and rows with
 * no engine mapping both no-op, same as the setter's engine half did.
 */
export const pushBacteriaModAssignmentsToEngine = inject(bacteriaParamBridgeDependencies)(({
    updateDevicePatch: updateDevicePatchFn,
    resolveEligibleDeviceWriteTarget: resolveEligibleDeviceWriteTargetFn,
}) => {
    return function pushBacteriaModAssignmentsToEngine(deviceId: string, assignments: BacteriaModAssignment[]): void {
        const target = resolveEligibleDeviceWriteTargetFn(deviceId);
        if (target.status !== 'eligible') {
            return;
        }

        const mapped = mapBacteriaModAssignments(assignments);
        if (!mapped) {
            return;
        }
        updateDevicePatchFn(target.trackId, target.deviceId, { modAssignments: mapped });
    };
});
