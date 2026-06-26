import { markerStore, takeLaneStore, trackStore } from '#/modules/Arrangement/stores';
import { automationStore } from '#/modules/Automation/stores';
import { hydrateKneadFromTrackStore } from '#/modules/Knead/useCases';
import { midiStore } from '#/modules/MIDI/stores';
import { arrangementStore, projectStore } from '#/modules/Project/stores';
import { hydrateSidechainRoutes } from '#/modules/Routing/useCases';
import { tempoMapStore, timeSignatureMapStore, transportStore } from '#/modules/Transport/stores';

import { DOC_PREFIX_ROOT } from '../../models/CrdtDocumentTypes';
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
 *
 * Honours the single-doc `docId` hint the repository threads through
 * `onChange` (§138.1): every project store is keyed inside the `DOC_PREFIX_ROOT`
 * document (see `createAutomergeStorage` call sites — all pass `DOC_PREFIX_ROOT`),
 * so a change to any *other* doc (a `branch_*` snapshot, `__branches__`) backs no
 * project store and must not trigger a full re-hydrate. A `undefined` hint marks a
 * bulk op (load / merge / snapshot) and always re-hydrates.
 */
export function setupProjectionBridge(): () => void {
    return automergeRepository.onChange((docId?: string) => {
        if (docId !== undefined && docId !== DOC_PREFIX_ROOT) {
            return;
        }
        projectCrdtToStores();
    });
}
