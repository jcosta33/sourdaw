import { markerStore, takeLaneStore, trackStore } from '#/modules/Arrangement/stores';
import { automationStore } from '#/modules/Automation/stores';
import { hydrateKneadFromTrackStore } from '#/modules/Knead/useCases';
import { midiStore } from '#/modules/MIDI/stores';
import { arrangementStore, projectStore } from '#/modules/Project/stores';
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

export function projectCrdtToStores(): void {
    for (const store of projectStores) {
        store.hydrate();
    }
    hydrateKneadFromTrackStore();
    hydrateSidechainRoutes();
}

/**
 * Set up the projection bridge: subscribe to Automerge changes and hydrate stores.
 * This is only needed for Phase 2 (incoming remote changes).
 * For local operations, AutomergeStorage handles the write path directly.
 */
export function setupProjectionBridge(): () => void {
    return automergeRepository.onChange(() => {
        projectCrdtToStores();
    });
}
