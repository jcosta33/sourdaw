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
};
