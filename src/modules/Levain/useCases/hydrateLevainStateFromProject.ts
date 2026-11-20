import { trackStore } from '#/modules/Arrangement/stores';

import { type LevainState } from '../stores/levainStore';

import { hydrateLevainStateFromDevice } from './hydrateLevainStateFromDevice';

/**
 * Read back the Levain state project truth holds for a device, or `null` when it
 * holds none.
 *
 * Registration and offline rendering initialize from this same projection.
 * Numeric project settings overlay the chosen instrument's defaults. A device
 * with no saved identity uses the default instrument without authoring a chunk.
 */
export function hydrateLevainStateFromProject(deviceId: string): LevainState | null {
    const tracks = trackStore.value?.tracks;
    if (!tracks) {
        return null;
    }

    for (const track of tracks) {
        for (const device of track.devices) {
            if (device.id !== deviceId) {
                continue;
            }
            return hydrateLevainStateFromDevice(device);
        }
    }
    return null;
}
