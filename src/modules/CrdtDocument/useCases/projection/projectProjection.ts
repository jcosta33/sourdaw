import { markerStore, takeLaneStore, trackStore } from '#/modules/Arrangement/stores';
import { automationStore, modulationStore } from '#/modules/Automation/stores';
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
    readonly derivedFromSiblingSlot?: true;
};

function slotProjection(slot: string, store: HydratableStore): ProjectSlotProjection {
    return {
        slot,
        store,
        hydrate: () => store.hydrate(),
        triggerSlots: [slot],
    };
}

/** Every project-state store backed by AutomergeStorage on the root document. */
export const projectSlotProjections: readonly ProjectSlotProjection[] = [
    slotProjection('tracks', trackStore),
    slotProjection('takeLanes', takeLaneStore),
    slotProjection('markers', markerStore),
    slotProjection('automation', automationStore),
    slotProjection('modulation', modulationStore),
    slotProjection('transport', transportStore),
    slotProjection('tempoMap', tempoMapStore),
    slotProjection('timeSignatureMap', timeSignatureMapStore),
    slotProjection('arrangements', arrangementStore),
    slotProjection('projectMeta', projectStore),
    slotProjection('cvGate', cvGateStore),
    slotProjection('actionHistory', actionHistoryStore),
    slotProjection('midi', midiStore),
    slotProjection('chordTrack', chordTrackStore),
    slotProjection('grooveTemplates', grooveTemplateStore),
    {
        slot: 'sidechainRoutes',
        store: sidechainStore,
        hydrate: hydrateSidechainRoutes,
        triggerSlots: ['sidechainRoutes'],
    },
    {
        // The Yeast projection also reconciles groove assignments against the
        // groove-template slot, so a groove change must re-run it.
        slot: 'yeast',
        store: yeastStore,
        hydrate: hydrateYeastCrdtProjection,
        triggerSlots: ['yeast', 'grooveTemplates'],
    },
    {
        // Knead clip state is rebuilt from trackStore clip payloads rather than
        // read back from its own slot, so `tracks` — not `knead` — drives it.
        slot: 'knead',
        store: kneadStore,
        hydrate: hydrateKneadFromTrackStore,
        triggerSlots: ['knead', 'tracks'],
        derivedFromSiblingSlot: true,
    },
];

/** Re-project every root slot. Used for bulk and document-origin changes. */
export function projectCrdtToStores(): void {
    for (const projection of projectSlotProjections) {
        projection.hydrate();
    }
}

type ProjectChangedCrdtSlotsInput = {
    /** Document slot keys the change touched. */
    readonly changedSlots: readonly string[];
    /**
     * `local-store` — a CRDT-backed store wrote these slots through the storage
     * adapter, which already holds their projected truth, so re-reading them is
     * pure cost (audit CC-1). Projections *derived* from those slots still run.
     * `document` — the change arrived from sync/merge/load, so every triggered
     * projection runs.
     */
    readonly origin: 'local-store' | 'document';
};

/**
 * Re-project only the slots a change actually touched.
 *
 * A local write to `tracks` used to re-hydrate all eighteen root slots, each
 * paying a `JSON.stringify` of its whole doc slot — cost proportional to the
 * project rather than to the edit (audit CC-1).
 */
export function projectChangedCrdtSlots({ changedSlots, origin }: ProjectChangedCrdtSlotsInput): void {
    if (changedSlots.length === 0) {
        return;
    }

    const changed = new Set(changedSlots);
    for (const projection of projectSlotProjections) {
        const hasTrigger = projection.triggerSlots.some((trigger) => {
            if (origin === 'local-store' && trigger === projection.slot) {
                return false;
            }
            return changed.has(trigger);
        });
        if (hasTrigger) {
            projection.hydrate();
        }
    }
}
