import { trackStore } from '#/modules/Arrangement/stores';
import { DEVICE_TYPE_IDS } from '#/utils/nativeDspDeviceTypes';

import { reconcileToasterKitFromProject } from './reconcileToasterKitFromProject';

/**
 * Reconcile every loaded Toaster on the project from project truth (#4764).
 *
 * The per-device store is the session mirror and the per-device reconcile is
 * JSON-diff gated, so a device whose kit already matches the document costs one
 * chunk comparison and nothing else — which is what makes calling this on every
 * project-document change affordable. Same shape and the same reasoning as
 * `reconcileGrandBouleDevicesFromProject` (#4894).
 */
export function reconcileToasterKitsFromProject(): void {
    const devices = trackStore.value?.tracks.flatMap((track) => track.devices) ?? [];
    for (const device of devices) {
        if (device.type !== DEVICE_TYPE_IDS.toaster) {
            continue;
        }
        reconcileToasterKitFromProject(device.id);
    }
}
