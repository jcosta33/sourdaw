import { type Logger } from '#/infra/logger/types';

import { type StorageAdapter } from './storage/types';

export type StoreOptions<TData> = {
    storage?: StorageAdapter<TData>;
    initialData?: TData;
    logger?: Logger;
};

/**
 * A reactive store that holds a snapshot of type `TData | null`.
 *
 * Matches the API surface of the old `Store<T>` class so that migration
 * is a straight find-and-replace:
 *
 *   Before: `new Store<T>(logger, { storage, initialData })`
 *   After:  `createStore<T>({ storage, initialData, logger })`
 *
 * All reads go through `.value`, all writes through `.set()` / `.update()`.
 */
export type Store<TData> = {
    /** Current snapshot. `null` when uninitialized. */
    readonly value: TData | null;

    /** Replace the current snapshot and notify subscribers. */
    set(value: TData | null): void;

    /** Atomic read-modify-write. */
    update(updater: (current: TData | null) => TData | null): void;

    /** Reset the store to `null` and clear backing storage. */
    clear(): void;

    /**
     * Hydrate the store from its backing storage without triggering a write-back.
     * Used after loading Automerge documents to populate the in-memory cache.
     */
    hydrate(): void;

    /** Subscribe to changes. Returns an unsubscribe function. */
    subscribe(callback: (value: TData | null) => void): () => void;

    /**
     * `useSyncExternalStore`-compatible subscribe (listener takes no args).
     * Prefer `.subscribe()` for general use — this exists for React integration.
     */
    subscribeReact(listener: () => void): () => void;

    /**
     * `useSyncExternalStore`-compatible snapshot getter.
     * Returns the current value — exists for React integration.
     */
    getSnapshot(): TData | null;
};
