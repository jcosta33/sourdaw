import { inject } from '#/infra/di/inject';

import { recallGrinderSnapshot } from '../../stores/grinderStore';

import { grinderParamBridgeDependencies } from './grinderParamBridgeDependencies';
import { syncGrinderPatchToAudio } from './syncGrinderPatchToAudio';

export const recallGrinderSnapshotWithAudio = inject(grinderParamBridgeDependencies)(({
    updateDeviceParam: update_device_param_fn,
    updateDevicePatch: update_device_patch_fn,
    persistDeviceParam: persist_device_param_fn,
    resolveEligibleDeviceWriteTarget: resolve_eligible_device_write_target_fn,
}) => {
    return function recallGrinderSnapshotWithAudio(deviceId: string, snapshotIndex: number): void {
        const target = resolve_eligible_device_write_target_fn(deviceId);
        if (target.status !== 'eligible') {
            return;
        }

        const next_patch = recallGrinderSnapshot(deviceId, snapshotIndex);
        if (!next_patch) {
            return;
        }

        syncGrinderPatchToAudio({
            patch: next_patch,
            ref: target,
            update_device_param: update_device_param_fn,
            update_device_patch: update_device_patch_fn,
            persist_device_param: persist_device_param_fn,
            resolve_eligible_device_write_target: resolve_eligible_device_write_target_fn,
        });
    };
});
