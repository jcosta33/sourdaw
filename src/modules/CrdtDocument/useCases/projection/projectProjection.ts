import { inject } from '#/infra/di/inject';
import { markerStore, takeLaneStore, trackStore } from '#/modules/Arrangement/stores';
import { automationStore } from '#/modules/Automation';
import { midiStore } from '#/modules/MIDI/stores';
import { arrangementStore, projectStore } from '#/modules/Project';
import { hydrateSidechainRoutes } from '#/modules/Routing/useCases';
import { tempoMapStore, timeSignatureMapStore, transportStore } from '#/modules/Transport/stores';

import { automergeRepository } from '../../repositories/automergeRepository';

/** All project-state stores backed by AutomergeStorage. */
const projectStores = [
    trackStore,
    automationStore,
    midiStore,
    transportStore,
    tempoMapStore,
    timeSignatureMapStore,
    markerStore,
    takeLaneStore,
    arrangementStore,
    projectStore,
];

/**
 * Hydrate all project stores from the current Automerge document state.
 *
 * Each store uses AutomergeStorage, which reads its key from the Automerge doc
 * and populates the in-memory cache. Subscribers are notified so the UI updates.
 *
 * Used after:
 * - Loading a project from IndexedDB/filesystem
 * - Receiving remote changes via sync (Phase 2)
 * - Merging an external .sdaw file
 */
export const projectCrdtToStores = inject({ hydrateSidechainRoutes })(
    ({ hydrateSidechainRoutes }) =>
        function projectCrdtToStores(): void {
            for (const store of projectStores) {
                store.hydrate();
            }
            hydrateSidechainRoutes();
        }
);

/**
 * Set up the projection bridge: subscribe to Automerge changes and hydrate stores.
 * This is only needed for Phase 2 (incoming remote changes).
 * For local operations, AutomergeStorage handles the write path directly.
 */
export const setupProjectionBridge = (): (() => void) => {
    return automergeRepository.onChange(() => {
        projectCrdtToStores();
    });
};
