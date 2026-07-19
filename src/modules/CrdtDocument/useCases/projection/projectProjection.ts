import { markerStore, takeLaneStore, trackStore } from '#/modules/Arrangement/stores';
import { automationStore } from '#/modules/Automation/stores';
import { cvGateStore } from '#/modules/CvGate/stores';
import { hydrateKneadFromTrackStore } from '#/modules/Knead/useCases';
import { grooveTemplateStore, midiStore } from '#/modules/MIDI/stores';
import { arrangementStore, projectStore } from '#/modules/Project/stores';
import { hydrateSidechainRoutes } from '#/modules/Routing/useCases';
import { tempoMapStore, timeSignatureMapStore, transportStore } from '#/modules/Transport/stores';
import { yeastStore } from '#/modules/Yeast/stores';

import { actionHistoryStore } from '../../stores/actionHistoryStore';

/** All project-state stores backed by AutomergeStorage. */
const projectStores = [
    trackStore,
    automationStore,
    midiStore,
    grooveTemplateStore,
    transportStore,
    tempoMapStore,
    timeSignatureMapStore,
    markerStore,
    takeLaneStore,
    arrangementStore,
    projectStore,
    cvGateStore,
    actionHistoryStore,
    yeastStore,
];

export function projectCrdtToStores(): void {
    for (const store of projectStores) {
        store.hydrate();
    }
    hydrateKneadFromTrackStore();
    hydrateSidechainRoutes();
}
