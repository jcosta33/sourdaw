import { projectSlotProjections } from './projectSlotProjections';

/**
 * Re-project every root slot from the document into its store.
 *
 * Used for bulk and document-origin changes (load, merge, sync, snapshot
 * restore), where the set of keys that moved is not knowable. A change that a
 * local CRDT-backed store performed names its slots and goes through
 * `projectChangedCrdtSlots` instead.
 */
export function projectCrdtToStores(): void {
    for (const projection of projectSlotProjections) {
        projection.hydrate();
    }
}
