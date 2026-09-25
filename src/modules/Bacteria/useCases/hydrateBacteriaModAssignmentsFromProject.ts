import { trackStore } from '#/modules/Arrangement/stores';

import { fromBacteriaModAssignmentsState } from '../models/BacteriaModAssignmentsState';

import type { BacteriaModAssignment } from '../models/BacteriaPatch';

/**
 * Read back the modulation-routing table project truth holds for a device, or
 * null when it holds none.
 *
 * The counterpart to `commitBacteriaModAssignments`, and the half that makes a
 * routing table survive a reload: registration alone gives every device an
 * empty table, so without this the document could hold a perfectly good
 * routing that nothing ever reads back.
 *
 * A pure read on purpose, mirroring `hydrateToasterKitFromProject`: it never
 * writes `bacteriaStore`, so calling it does not itself count as an edit for
 * the persistence subscriber watching that store.
 *
 * Returns null both for a device that has never had a table committed and for
 * a chunk this build cannot read; `fromBacteriaModAssignmentsState` returns
 * null for those rather than degrading to a default, because an empty table
 * and "nothing stored" mean the same thing to every caller here.
 */
export function hydrateBacteriaModAssignmentsFromProject(deviceId: string): BacteriaModAssignment[] | null {
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
            return fromBacteriaModAssignmentsState(device.deviceState);
        }
    }
    return null;
}
