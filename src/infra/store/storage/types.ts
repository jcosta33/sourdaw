export type StorageAdapter<TData> = {
    get(): TData | null;
    set(value: TData | null): void;
    clear(): void;
    isSupported(): boolean;
    /** Hydrate the cache from the backing store without triggering a write-back.
     *  Returns true if the cached value changed. */
    hydrate?(): boolean;
    /** Subscribe to visible-value changes that happen OUTSIDE a synchronous
     *  get/set/clear/hydrate call — e.g. a deferred CRDT write committing or
     *  aborting after an interleaved hydrate. Adapters without deferred
     *  visibility changes omit this. Returns an unsubscribe function. */
    subscribe?(listener: () => void): () => void;
    /** Replace the visible value WITHOUT authoring a write to the backing
     *  store.
     *
     *  Implemented only by adapters whose backing store is shared with other
     *  replicas. A sanitizer is a read-side guard: it decides what this build
     *  is willing to show, using a structural, version-blind validator. That
     *  makes it unfit to edit shared truth — it cannot distinguish a row a
     *  newer build wrote from a corrupt one, and rewriting a shared document
     *  from one replica's opinion deletes, for every peer, rows another build
     *  reads perfectly well.
     *
     *  Adapters backed by storage only this replica can see omit this, so the
     *  caller falls back to `set()`. There repairing the backing store is the
     *  point and there is no peer to lose. */
    setProjected?(value: TData | null): void;
};
