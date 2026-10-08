import { trackStore } from '#/modules/Arrangement/stores';
import { DEVICE_TYPE_IDS } from '#/utils/nativeDspDeviceTypes';

import { reconcileCrumbsDeviceStateFromProject } from './reconcileCrumbsDeviceStateFromProject';

/**
 * Reconcile every loaded Crumbs on the project from project truth (#4764).
 *
 * The mode/file-path comparison in the per-device reconcile reads equal for
 * every device whose session entry already matches the document, so a sweep on
 * every project-document change costs one decoded chunk per device — the same
 * affordability argument `reconcileGrandBouleDevicesFromProject` makes (#4894).
 */
export function reconcileCrumbsDeviceStatesFromProject(): void {
    const devices = trackStore.value?.tracks.flatMap((track) => track.devices) ?? [];
    for (const device of devices) {
        if (device.type !== DEVICE_TYPE_IDS.builtinCrumbs) {
            continue;
        }
        reconcileCrumbsDeviceStateFromProject(device.id);
    }
}
