import { inject } from '#/infra/di/inject';
import { createFindDeviceRef } from '#/utils/createFindDeviceRef';

import { recallGrinderSnapshot } from '../../stores/grinderStore';

import { grinderParamBridgeDependencies } from './grinderParamBridgeDependencies';
import { syncGrinderPatchToAudio } from './syncGrinderPatchToAudio';

export const recallGrinderSnapshotWithAudio = inject(grinderParamBridgeDependencies)(({
    getAllTracks: get_all_tracks_fn,
    updateDeviceParam: update_device_param_fn,
    updateDevicePatch: update_device_patch_fn,
    persistDeviceParam: persist_device_param_fn,
}) => {
    const find_device_ref = createFindDeviceRef(get_all_tracks_fn);

    return function recallGrinderSnapshotWithAudio(deviceId: string, snapshotIndex: number): void {
        const next_patch = recallGrinderSnapshot(deviceId, snapshotIndex);
        if (!next_patch) {
            return;
        }

        const ref = find_device_ref(deviceId);
        if (!ref) {
            return;
        }

        syncGrinderPatchToAudio({
            patch: next_patch,
            ref,
            update_device_param: update_device_param_fn,
            update_device_patch: update_device_patch_fn,
            persist_device_param: persist_device_param_fn,
        });
    };
});
