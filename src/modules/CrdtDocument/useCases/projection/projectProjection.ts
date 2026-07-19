import { markerStore, takeLaneStore, trackStore } from '#/modules/Arrangement/stores';
import { automationStore } from '#/modules/Automation/stores';
import { cvGateStore } from '#/modules/CvGate/stores';
import { hydrateKneadFromTrackStore } from '#/modules/Knead/useCases';
import { hydrateMidiCrdtProjection } from '#/modules/MIDI/useCases';
import { arrangementStore, projectStore } from '#/modules/Project/stores';
import { hydrateSidechainRoutes } from '#/modules/Routing/useCases';
import { tempoMapStore, timeSignatureMapStore, transportStore } from '#/modules/Transport/stores';
import { hydrateYeastCrdtProjection } from '#/modules/Yeast/useCases';

import { actionHistoryStore } from '../../stores/actionHistoryStore';

/** All project-state stores backed by AutomergeStorage. */
const projectStores = [
    trackStore,
    automationStore,
    transportStore,
    tempoMapStore,
    timeSignatureMapStore,
    markerStore,
    takeLaneStore,
    arrangementStore,
    projectStore,
    cvGateStore,
    actionHistoryStore,
];

export function projectCrdtToStores(): void {
    for (const store of projectStores) {
        store.hydrate();
    }
    hydrateMidiCrdtProjection();
    hydrateYeastCrdtProjection();
    hydrateKneadFromTrackStore();
    hydrateSidechainRoutes();
}
