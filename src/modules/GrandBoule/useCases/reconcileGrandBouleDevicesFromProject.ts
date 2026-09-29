import { trackStore } from '#/modules/Arrangement/stores';
import { DEVICE_TYPE_IDS } from '#/utils/nativeDspDeviceTypes';

import { reconcileGrandBouleDeviceStateFromProject } from './reconcileGrandBouleDeviceStateFromProject';

/**
 * Reconcile every Grand Boule device on the project from project truth.
 *
 * The per-device store is a session mirror, and the per-device hydrate is
 * JSON-diff gated, so a device whose store already matches the document costs
 * one chunk comparison and nothing else — which is what makes calling this on
 * every project-document change affordable (#4894).
 */
export function reconcileGrandBouleDevicesFromProject(): void {
    const devices = trackStore.value?.tracks.flatMap((track) => track.devices) ?? [];
    for (const device of devices) {
        if (device.type !== DEVICE_TYPE_IDS.grandBoule) {
            continue;
        }
        reconcileGrandBouleDeviceStateFromProject(device.id);
    }
}
