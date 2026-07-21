import { inject } from '#/infra/di/inject';

import { type GrinderPatch } from '../../models/GrinderPatch';
import { loadGrinderPatch } from '../../stores/grinderStore';

import { grinderParamBridgeDependencies } from './grinderParamBridgeDependencies';
import { syncGrinderPatchToAudio } from './syncGrinderPatchToAudio';

export const loadGrinderPatchWithAudio = inject(grinderParamBridgeDependencies)(({
    updateDeviceParam: update_device_param_fn,
    updateDevicePatch: update_device_patch_fn,
    persistDeviceParam: persist_device_param_fn,
    resolveEligibleDeviceWriteTarget: resolve_eligible_device_write_target_fn,
}) => {
    return function loadGrinderPatchWithAudio(deviceId: string, patch: GrinderPatch): void {
        const target = resolve_eligible_device_write_target_fn(deviceId);
        if (target.status !== 'eligible') {
            return;
        }

        // loadGrinderPatch migrates the incoming patch once and returns the stored,
        // already-migrated result; reuse it so the audio sync path does not migrate again.
        const migrated_patch = loadGrinderPatch(deviceId, patch);

        syncGrinderPatchToAudio({
            patch: migrated_patch,
            ref: target,
            update_device_param: update_device_param_fn,
            update_device_patch: update_device_patch_fn,
            persist_device_param: persist_device_param_fn,
            resolve_eligible_device_write_target: resolve_eligible_device_write_target_fn,
        });
    };
});
