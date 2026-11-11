import { cancelPendingFermenterPatchWrites } from './fermenterParamBridge/loadFermenterPatchWithAudio';
import { mapFermenterPatchToDspPatch } from './fermenterParamBridge/mapFermenterPatchToDspPatch';
import { getFermenterDependencies } from './getFermenterDependencies';
import { hydrateFermenterFromProject } from './hydrateFermenterFromProject';

/** Bring the ephemeral panel and audible engine to the same committed whole patch. */
export function reconcileFermenterPatchFromProject(deviceId: string): void {
    const target = getFermenterDependencies().resolveEligibleDeviceWriteTarget(deviceId);
    if (target.status !== 'eligible') {
        return;
    }
    const patch = hydrateFermenterFromProject(deviceId);
    if (!patch) {
        return;
    }
    cancelPendingFermenterPatchWrites(deviceId);
    getFermenterDependencies().updateDevicePatch?.(
        target.trackId,
        target.deviceId,
        mapFermenterPatchToDspPatch({ patch })
    );
}
