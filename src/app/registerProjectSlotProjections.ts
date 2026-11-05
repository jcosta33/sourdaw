import {
    adjustmentLayerStore,
    gainEnvelopeStore,
    markerStore,
    takeLaneStore,
    trackStore,
    vcaGroupStore,
    warpStateStore,
} from '#/modules/Arrangement/stores';
import { automationStore, modulationStore } from '#/modules/Automation/stores';
import { midiLearnStore } from '#/modules/ControlSurface/stores';
import {
    drumPreviewSourcePort,
    kernelSlotProjections,
    projectSlotProjectionRegistry,
    slotProjection,
} from '#/modules/CrdtDocument/useCases';
import { cvGateStore } from '#/modules/CvGate/stores';
import { kneadStore } from '#/modules/Knead/stores';
import { hydrateKneadFromTrackStore } from '#/modules/Knead/useCases';
import { chordTrackStore, grooveTemplateStore, midiStore } from '#/modules/MIDI/stores';
import { projectDrumPreviewCandidateNotes } from '#/modules/MIDI/useCases';
import { arrangementStore, projectStore } from '#/modules/Project/stores';
import { sidechainStore } from '#/modules/Routing/stores';
import { hydrateSidechainRoutes } from '#/modules/Routing/useCases';
import { tempoMapStore, timeSignatureMapStore, transportStore } from '#/modules/Transport/stores';
import { yeastStore } from '#/modules/Yeast/stores';
import { hydrateYeastCrdtProjection } from '#/modules/Yeast/useCases';

type ProjectSlotProjections = Parameters<typeof projectSlotProjectionRegistry.configure>[0];

let productionProjections: ProjectSlotProjections | null = null;

/** Every project-state store backed by AutomergeStorage on the root document, in projection order. */
function buildProductionProjections(): ProjectSlotProjections {
    return [
        slotProjection({ slot: 'tracks', getStore: () => trackStore }),
        slotProjection({ slot: 'adjustmentLayers', getStore: () => adjustmentLayerStore }),
        slotProjection({ slot: 'takeLanes', getStore: () => takeLaneStore }),
        slotProjection({ slot: 'markers', getStore: () => markerStore }),
        slotProjection({ slot: 'vcaGroups', getStore: () => vcaGroupStore }),
        slotProjection({ slot: 'gainEnvelopes', getStore: () => gainEnvelopeStore }),
        slotProjection({ slot: 'warpStates', getStore: () => warpStateStore }),
        slotProjection({ slot: 'automation', getStore: () => automationStore }),
        slotProjection({ slot: 'modulation', getStore: () => modulationStore }),
        slotProjection({ slot: 'transport', getStore: () => transportStore }),
        slotProjection({ slot: 'tempoMap', getStore: () => tempoMapStore }),
        slotProjection({ slot: 'timeSignatureMap', getStore: () => timeSignatureMapStore }),
        slotProjection({ slot: 'arrangements', getStore: () => arrangementStore }),
        slotProjection({ slot: 'projectMeta', getStore: () => projectStore }),
        slotProjection({ slot: 'cvGate', getStore: () => cvGateStore }),
        slotProjection({ slot: 'midiLearn', getStore: () => midiLearnStore }),
        kernelSlotProjections.actionHistory,
        kernelSlotProjections.commandBatchIdempotency,
        slotProjection({ slot: 'midi', getStore: () => midiStore }),
        slotProjection({ slot: 'chordTrack', getStore: () => chordTrackStore }),
        slotProjection({ slot: 'grooveTemplates', getStore: () => grooveTemplateStore }),
        slotProjection({
            slot: 'sidechainRoutes',
            getStore: () => sidechainStore,
            hydrate: () => hydrateSidechainRoutes(),
        }),
        slotProjection({
            slot: 'yeast',
            getStore: () => yeastStore,
            hydrate: () => hydrateYeastCrdtProjection(),
        }),
        slotProjection({
            // Knead clip state is rebuilt from trackStore clip payloads rather than
            // read back from its own slot, so `tracks` — not `knead` — drives it.
            slot: 'knead',
            getStore: () => kneadStore,
            hydrate: () => hydrateKneadFromTrackStore(),
            triggerSlots: ['knead', 'tracks'],
            derivedFromSiblingSlot: true,
        }),
    ];
}

/**
 * Give the CRDT kernel its reads of domain stores: the root slot projections
 * that hydrate each store from the document, and the arrangement and MIDI reads
 * drum preview branches are prepared from. The kernel may not import the
 * modules that own those stores, so the composition root supplies them; until
 * it does, projecting or preparing a preview throws.
 *
 * Bootstrap calls this once before anything can project. Specs that reach real
 * projection call it in their setup. Repeating it is safe: the list is built
 * once per module instance, and registering the identical list again is a no-op.
 */
export function registerProjectSlotProjections(): void {
    productionProjections ??= buildProductionProjections();
    projectSlotProjectionRegistry.configure(productionProjections);
    drumPreviewSourcePort.setProvider({
        readTracks: () => trackStore.value?.tracks ?? [],
        readMidiState: () => midiStore.value,
        projectCandidateNotes: projectDrumPreviewCandidateNotes,
    });
}
