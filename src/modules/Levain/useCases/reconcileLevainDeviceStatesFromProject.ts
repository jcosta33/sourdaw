import { trackStore } from '#/modules/Arrangement/stores';
import { DEVICE_TYPE_IDS } from '#/utils/nativeDspDeviceTypes';

import { reconcileLevainDeviceStateFromProject } from './reconcileLevainDeviceStateFromProject';

/**
 * Reconcile every loaded Levain on the project from project truth (#4764).
 *
 * The identity comparison in the per-device reconcile reads equal for every
 * device whose session entry already matches the document, so a sweep on every
 * project-document change costs two string comparisons per device — the same
 * affordability argument `reconcileGrandBouleDevicesFromProject` makes (#4894).
 */
export function reconcileLevainDeviceStatesFromProject(): void {
    const devices = trackStore.value?.tracks.flatMap((track) => track.devices) ?? [];
    for (const device of devices) {
        if (device.type !== DEVICE_TYPE_IDS.levain) {
            continue;
        }
        reconcileLevainDeviceStateFromProject(device.id);
    }
}
