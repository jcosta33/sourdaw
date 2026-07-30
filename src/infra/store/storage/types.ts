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
    /** Replace the visible value WITHOUT authoring a write to backing truth.
     *
     *  Implemented by adapters whose backing truth must survive a sanitizer:
     *  shared documents and local values written by a newer schema. A
     *  sanitizer is a read-side guard, so it is unfit to delete content this
     *  build does not understand.
     *
     *  Adapters backed by compatible local storage omit this, so the caller
     *  falls back to `set()` and repairs corrupt values in place. */
    setProjected?(value: TData | null): void;
};
