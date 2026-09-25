import { type BacteriaModAssignment } from '../models/BacteriaPatch';
import { bacteriaStore } from '../stores/bacteriaStore';

import { commitBacteriaModAssignments } from './commitBacteriaModAssignments';
import { hydrateBacteriaModAssignmentsFromProject } from './hydrateBacteriaModAssignmentsFromProject';

function rowsEqual(a: readonly BacteriaModAssignment[], b: readonly BacteriaModAssignment[]): boolean {
    if (a.length !== b.length) {
        return false;
    }
    return a.every((row, index) => {
        const other = b[index]!;
        return (
            row.sourceId === other.sourceId &&
            row.targetParam === other.targetParam &&
            row.amount === other.amount &&
            row.bipolar === other.bipolar
        );
    });
}

/**
 * Mirror every Bacteria modulation-routing edit into project truth.
 *
 * Subscribing to the session store rather than calling `commitBacteriaModAssignments`
 * from each mutation site is deliberate, mirroring `initToasterKitPersistence`: the
 * table is reached from the panel's routing matrix and from `loadBacteriaPatchWithAudio`
 * loading a whole patch, and a persistence call added to each site is a list that goes
 * stale the moment a new caller appears. One subscription cannot miss a path.
 *
 * Change is detected by **`modAssignments` object identity**, not the whole patch or
 * state: `updateBacteriaMeters` rewrites `inputDb`/`outputDb`/`bandLevels`/`latency` on
 * every meter tick while keeping the same `patch` and the same `modAssignments`
 * reference, so a coarser comparison would commit — and dirty the project — on every
 * meter frame.
 *
 * A device is recorded on first sight without committing: registration is a device's
 * first appearance, and the table it appears with is either the default empty table or
 * the one just read back from the document by the load subscriber — neither is an edit.
 *
 * Beyond that, a real identity change still skips the commit when the new table equals,
 * row for row, the table the document's current `deviceState` already decodes to (an
 * absent chunk reads as an empty table). Re-hydrating a table the document already holds
 * — the load subscriber calling `setBacteriaModAssignmentsWithAudio` with what it just
 * read back — must not turn around and write, and dirty, the project it read from.
 */
export function initBacteriaModAssignmentsPersistence(): () => void {
    const committedTables = new Map<string, BacteriaModAssignment[]>();

    return bacteriaStore.subscribe((instances) => {
        if (!instances) {
            committedTables.clear();
            return;
        }

        for (const [deviceId, state] of Object.entries(instances)) {
            const previous = committedTables.get(deviceId);
            committedTables.set(deviceId, state.patch.modAssignments);

            if (previous === undefined || previous === state.patch.modAssignments) {
                continue;
            }

            const documented = hydrateBacteriaModAssignmentsFromProject(deviceId) ?? [];
            if (rowsEqual(state.patch.modAssignments, documented)) {
                continue;
            }

            commitBacteriaModAssignments(deviceId);
        }

        // Drop devices that are gone, so a device id reused by a later load is
        // treated as first sight again rather than compared against a stale table.
        for (const deviceId of committedTables.keys()) {
            if (!(deviceId in instances)) {
                committedTables.delete(deviceId);
            }
        }
    });
}
