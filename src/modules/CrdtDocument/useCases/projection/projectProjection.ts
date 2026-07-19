import { batchStoreUpdates } from '#/infra/store/createStore';
import { adjustmentLayerStore, markerStore, takeLaneStore, trackStore } from '#/modules/Arrangement/stores';
import { automationStore } from '#/modules/Automation/stores';
import { cvGateStore } from '#/modules/CvGate/stores';
import { hydrateKneadFromTrackStore } from '#/modules/Knead/useCases';
import { midiStore } from '#/modules/MIDI/stores';
import { arrangementStore, projectStore } from '#/modules/Project/stores';
import { hydrateSidechainRoutes } from '#/modules/Routing/useCases';
import { tempoMapStore, timeSignatureMapStore, transportStore } from '#/modules/Transport/stores';

import { actionHistoryStore } from '../../stores/actionHistoryStore';

import { projectProjectionDependencies } from './projectProjectionDependencies';

/** All project-state stores backed by AutomergeStorage. */
const projectStores = [
    adjustmentLayerStore,
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
    cvGateStore,
    actionHistoryStore,
];

export function projectCrdtToStores(): void {
    batchStoreUpdates(() => {
        for (const store of projectStores) {
            store.hydrate();
        }
        projectProjectionDependencies.reconcileProjectedProjectState();
        hydrateKneadFromTrackStore();
        hydrateSidechainRoutes();
    });
}
