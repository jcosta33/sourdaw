import { createUserAppActionRefusalEpisodes } from '#/modules/Command/useCases';

import { type BacteriaModAssignment } from '../models/BacteriaPatch';
import { bacteriaStore } from '../stores/bacteriaStore';

import { commitBacteriaModAssignments } from './commitBacteriaModAssignments';
import { isBacteriaModAssignmentsDocumented } from './isBacteriaModAssignmentsDocumented';

/**
 * Mirror every Bacteria modulation-routing edit into project truth.
 *
 * The panel's routing gestures update the session store before this subscriber
 * writes their table. Factory presets write the table inside their project action
 * and then hydrate the session store from the published chunk.
 *
 * Change is detected by **`modAssignments` object identity**, not the whole patch or
 * state: `updateBacteriaMeters` rewrites `inputDb`/`outputDb`/`bandLevels`/`latency` on
 * every meter tick while keeping the same `patch` and the same `modAssignments`
 * reference, so a coarser comparison would commit — and dirty the project — on every
 * meter frame.
 *
 * A device is recorded on first sight without committing: registration is a device's
 * first appearance, and the table it appears with is either the default empty table, the
 * one just read back from the document by the load subscriber, or the one the panel's own
 * `hydrateBacteriaPatchFromProject` projected from `deviceState` on mount — none of the
 * three is an edit.
 *
 * Beyond that, a real identity change still skips the commit when the new table equals,
 * row for row, the table the document's current `deviceState` already decodes to (an
 * absent chunk reads as an empty table). Re-hydrating a table the document already holds
 * — the load subscriber calling `setBacteriaModAssignmentsWithAudio` with what it just
 * read back — must not turn around and write, and dirty, the project it read from.
 */
export function initBacteriaModAssignmentsPersistence(): () => void {
    const committedTables = new Map<string, BacteriaModAssignment[]>();
    const episodes = createUserAppActionRefusalEpisodes({
        onAdmitted: (deviceId) => {
            const rows = bacteriaStore.value?.[deviceId]?.patch.modAssignments;
            if (!rows || isBacteriaModAssignmentsDocumented(deviceId, rows)) {
                return;
            }
            commitBacteriaModAssignments(deviceId, episodes);
        },
    });

    return bacteriaStore.subscribe((instances) => {
        if (!instances) {
            committedTables.clear();
            episodes.endAll();
            return;
        }

        for (const [deviceId, state] of Object.entries(instances)) {
            const previous = committedTables.get(deviceId);
            committedTables.set(deviceId, state.patch.modAssignments);

            if (previous === undefined || previous === state.patch.modAssignments) {
                continue;
            }

            if (isBacteriaModAssignmentsDocumented(deviceId, state.patch.modAssignments)) {
                continue;
            }

            commitBacteriaModAssignments(deviceId, episodes);
        }

        // Drop devices that are gone, so a device id reused by a later load is
        // treated as first sight again rather than compared against a stale table.
        for (const deviceId of committedTables.keys()) {
            if (!(deviceId in instances)) {
                committedTables.delete(deviceId);
                episodes.end(deviceId);
            }
        }
    });
}
