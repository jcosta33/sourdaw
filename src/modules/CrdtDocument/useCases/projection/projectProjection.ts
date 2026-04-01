import { markerStore } from '#/modules/Arrangement/stores/markerStore';
import { takeLaneStore } from '#/modules/Arrangement/stores/takeLaneStore';
import { trackStore } from '#/modules/Arrangement/stores/trackStore';
import { automationStore } from '#/modules/Automation/stores/automationStore';
import { midiStore } from '#/modules/MIDI/stores/midiStore';
import { arrangementStore } from '#/modules/Project/stores/arrangementStore';
import { projectStore } from '#/modules/Project/stores/projectStore';
import { sidechainStore } from '#/modules/Routing/stores/sidechainStore';
import { tempoMapStore } from '#/modules/Transport/stores/tempoMapStore';
import { timeSignatureMapStore } from '#/modules/Transport/stores/timeSignatureMapStore';
import { transportStore } from '#/modules/Transport/stores/transportStore';

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
    sidechainStore,
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
export const projectCrdtToStores = (): void => {
    for (const store of projectStores) {
        store.hydrate();
    }
};

/**
 * Set up the projection bridge: subscribe to Automerge changes and hydrate stores.
 * This is only needed for Phase 2 (incoming remote changes).
 * For local operations, AutomergeStorage handles the write path directly.
 */
export const setupProjectionBridge = (): () => void => {
    return automergeRepository.onChange(() => {
        projectCrdtToStores();
    });
};
