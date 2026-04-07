export type StorageAdapter<TData> = {
    get(): TData | null;
    set(value: TData | null): void;
    clear(): void;
    isSupported(): boolean;
    /** Hydrate the cache from the backing store without triggering a write-back.
     *  Returns true if the cached value changed. */
    hydrate?(): boolean;
};
