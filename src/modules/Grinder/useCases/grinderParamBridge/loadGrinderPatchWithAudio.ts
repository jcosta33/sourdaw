import { inject } from '#/infra/di/inject';

import { type GrinderPatch } from '../../models/GrinderPatch';
import { loadGrinderPatch } from '../../stores/grinderStore';

import { grinderParamBridgeDependencies } from './grinderParamBridgeDependencies';
import { createFindDeviceRef } from './helpers';
import { syncGrinderPatchToAudio } from './syncGrinderPatchToAudio';

export const loadGrinderPatchWithAudio = inject(grinderParamBridgeDependencies)(({
    getAllTracks: get_all_tracks_fn,
    updateDeviceParam: update_device_param_fn,
    updateDevicePatch: update_device_patch_fn,
    persistDeviceParam: persist_device_param_fn,
}) => {
    const find_device_ref = createFindDeviceRef(get_all_tracks_fn);

    return function loadGrinderPatchWithAudio(deviceId: string, patch: GrinderPatch): void {
        // loadGrinderPatch migrates the incoming patch once and returns the stored,
        // already-migrated result; reuse it so the audio sync path does not migrate again.
        const migrated_patch = loadGrinderPatch(deviceId, patch);

        const ref = find_device_ref(deviceId);
        if (!ref) {
            return;
        }

        syncGrinderPatchToAudio({
            patch: migrated_patch,
            ref,
            update_device_param: update_device_param_fn,
            update_device_patch: update_device_patch_fn,
            persist_device_param: persist_device_param_fn,
        });
    };
});
