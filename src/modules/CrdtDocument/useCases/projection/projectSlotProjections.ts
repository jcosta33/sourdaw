import { gainEnvelopeStore, markerStore, takeLaneStore, trackStore, vcaGroupStore } from '#/modules/Arrangement/stores';
import { automationStore, modulationStore } from '#/modules/Automation/stores';
import { midiLearnStore } from '#/modules/ControlSurface/stores';
import { cvGateStore } from '#/modules/CvGate/stores';
import { kneadStore } from '#/modules/Knead/stores';
import { hydrateKneadFromTrackStore } from '#/modules/Knead/useCases';
import { chordTrackStore, grooveTemplateStore, midiStore } from '#/modules/MIDI/stores';
import { arrangementStore, projectStore } from '#/modules/Project/stores';
import { sidechainStore } from '#/modules/Routing/stores';
import { hydrateSidechainRoutes } from '#/modules/Routing/useCases';
import { tempoMapStore, timeSignatureMapStore, transportStore } from '#/modules/Transport/stores';
import { yeastStore } from '#/modules/Yeast/stores';
import { hydrateYeastCrdtProjection } from '#/modules/Yeast/useCases';

import { actionHistoryStore } from '../../stores/actionHistoryStore';

type HydratableStore = {
    hydrate: () => void;
};

/**
 * One CRDT-backed root slot and the projection that reads it back into a store.
 *
 * This registry is the single derived source for the projection layer:
 * `projectCrdtToStores` iterates it, `projectChangedCrdtSlots` dispatches
 * through it, and the projection-completeness guard checks it against the
 * `createAutomergeStorage(DOC_PREFIX_ROOT, …)` call sites found in source. A
 * slot that gains a document key without gaining an entry here fails CI.
 */
export type ProjectSlotProjection = {
    /** Document slot key. Wire format (on disk and on the sync wire) — never rename. */
    readonly slot: string;
    /** The store that owns this slot's read model. */
    readonly store: HydratableStore;
    /** The projection pass for this slot. Reads only; never writes the document. */
    readonly hydrate: () => void;
    /**
     * Document slots whose change must re-run this projection. Always contains
     * `slot`; a projection rebuilt from a sibling store also lists that store's
     * slot, so a change there still refreshes it.
     */
    readonly triggerSlots: readonly string[];
    /**
     * True when `store.hydrate()` is NOT this slot's projection entry point —
     * the store is rebuilt from another slot's read model instead.
     */
    readonly derivedFromSiblingSlot: boolean;
};

type SlotProjectionInput = {
    slot: string;
    /**
     * Resolved on access rather than captured, so building the registry at
     * module init never reads the imported store bindings. Reading them there
     * would force every consumer that merely imports the CrdtDocument use
     * cases to instantiate all eighteen store modules.
     */
    getStore: () => HydratableStore;
    hydrate?: () => void;
    triggerSlots?: readonly string[];
    derivedFromSiblingSlot?: boolean;
};

function slotProjection(input: SlotProjectionInput): ProjectSlotProjection {
    const { getStore, slot } = input;
    return {
        slot,
        get store(): HydratableStore {
            return getStore();
        },
        hydrate: input.hydrate ?? (() => getStore().hydrate()),
        triggerSlots: input.triggerSlots ?? [slot],
        derivedFromSiblingSlot: input.derivedFromSiblingSlot ?? false,
    };
}

/** Every project-state store backed by AutomergeStorage on the root document. */
export const projectSlotProjections: readonly ProjectSlotProjection[] = [
    slotProjection({ slot: 'tracks', getStore: () => trackStore }),
    slotProjection({ slot: 'takeLanes', getStore: () => takeLaneStore }),
    slotProjection({ slot: 'markers', getStore: () => markerStore }),
    slotProjection({ slot: 'vcaGroups', getStore: () => vcaGroupStore }),
    slotProjection({ slot: 'gainEnvelopes', getStore: () => gainEnvelopeStore }),
    slotProjection({ slot: 'automation', getStore: () => automationStore }),
    slotProjection({ slot: 'modulation', getStore: () => modulationStore }),
    slotProjection({ slot: 'transport', getStore: () => transportStore }),
    slotProjection({ slot: 'tempoMap', getStore: () => tempoMapStore }),
    slotProjection({ slot: 'timeSignatureMap', getStore: () => timeSignatureMapStore }),
    slotProjection({ slot: 'arrangements', getStore: () => arrangementStore }),
    slotProjection({ slot: 'projectMeta', getStore: () => projectStore }),
    slotProjection({ slot: 'cvGate', getStore: () => cvGateStore }),
    slotProjection({ slot: 'midiLearn', getStore: () => midiLearnStore }),
    slotProjection({ slot: 'actionHistory', getStore: () => actionHistoryStore }),
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
