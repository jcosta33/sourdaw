import { inject } from '#/infra/di/inject';

import { type GrinderPatch, migrateGrinderPatch } from '../../models/GrinderPatch';
import { loadGrinderPatch } from '../../stores/grinderStore';

import { grinderParamBridgeDependencies } from './grinderParamBridgeDependencies';
import { createFindDeviceRef } from './helpers';
import { syncGrinderPatchToAudio } from './syncGrinderPatchToAudio';

export const loadGrinderPatchWithAudio = inject(grinderParamBridgeDependencies)(({
    getAllTracks: get_all_tracks_fn,
    updateDeviceParam: update_device_param_fn,
    persistDeviceParam: persist_device_param_fn,
}) => {
    const find_device_ref = createFindDeviceRef(get_all_tracks_fn);

    return function loadGrinderPatchWithAudio(deviceId: string, patch: GrinderPatch): void {
        const migrated_patch = migrateGrinderPatch(patch);
        loadGrinderPatch(deviceId, migrated_patch);

        const ref = find_device_ref(deviceId);
        if (!ref) {
            return;
        }

        syncGrinderPatchToAudio({
            patch: migrated_patch,
            ref,
            update_device_param: update_device_param_fn,
            persist_device_param: persist_device_param_fn,
        });
    };
});
