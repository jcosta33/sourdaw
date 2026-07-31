import { trackStore } from '#/modules/Arrangement/stores';

import { fromToasterKitState } from '../models/ToasterKitState';

import type { ToasterKit } from '../models/ToasterKit';

/**
 * Read back the kit project truth holds for a device, or null when it holds none.
 *
 * The counterpart to `commitToasterKit`, and the half that makes a kit survive a
 * reload: registration alone gives every device the default kit, so without this the
 * document could hold a perfectly good kit that nothing ever reads back.
 *
 * A pure read on purpose. The resolved kit is handed to `registerToasterDevice` so
 * the device's record is *created* holding it, in a single store write. Loading it
 * afterwards would work too, but it would make the session store change twice per
 * load — and the second change is indistinguishable from a user edit, so the
 * persistence subscriber would mirror the freshly loaded kit straight back into the
 * document and dirty a project nobody had touched.
 *
 * Returns null both for a device that has never been edited and for a chunk this
 * build cannot read; `fromToasterKitState` degrades a malformed or wrongly-versioned
 * chunk to the default kit rather than throwing, and the caller's own default covers
 * the absent case.
 */
export function hydrateToasterKitFromProject(deviceId: string): ToasterKit | null {
    const tracks = trackStore.value?.tracks;
    if (!tracks) {
        return null;
    }

    for (const track of tracks) {
        for (const device of track.devices) {
            if (device.id !== deviceId) {
                continue;
            }
            if (!device.deviceState) {
                return null;
            }
            return fromToasterKitState(device.deviceState);
        }
    }
    return null;
}
