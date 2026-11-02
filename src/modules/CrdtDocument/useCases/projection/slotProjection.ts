import { type StorageHydrateOptions } from '#/infra/store/storage/types';

type HydratableStore = {
    hydrate: (options?: StorageHydrateOptions) => void;
};

/**
 * One CRDT-backed root slot and the projection that reads it back into a store.
 *
 * The registry of these is the single derived source for the projection layer:
 * `projectCrdtToStores` iterates it, `projectChangedCrdtSlots` dispatches
 * through it, and the projection-completeness guard checks it against the
 * `createAutomergeStorage(DOC_PREFIX_ROOT, …)` call sites found in source. A
 * slot that gains a document key without gaining an entry fails CI.
 */
export type ProjectSlotProjection = {
    /** Document slot key. Wire format (on disk and on the sync wire) — never rename. */
    readonly slot: string;
    /** The store that owns this slot's read model. */
    readonly store: HydratableStore;
    /** The projection pass for this slot. Reads only; never writes the document. */
    readonly hydrate: (options?: StorageHydrateOptions) => void;
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
     * Resolved on access rather than captured, so building an entry never reads
     * the store binding. Reading it there would force whoever builds the
     * registry to instantiate every store module, in whatever order the import
     * graph happens to evaluate them.
     */
    getStore: () => HydratableStore;
    hydrate?: (options?: StorageHydrateOptions) => void;
    triggerSlots?: readonly string[];
    derivedFromSiblingSlot?: boolean;
};

export function slotProjection(input: SlotProjectionInput): ProjectSlotProjection {
    const { getStore, slot } = input;
    return {
        slot,
        get store(): HydratableStore {
            return getStore();
        },
        hydrate: input.hydrate ?? ((options) => getStore().hydrate(options)),
        triggerSlots: input.triggerSlots ?? [slot],
        derivedFromSiblingSlot: input.derivedFromSiblingSlot ?? false,
    };
}
