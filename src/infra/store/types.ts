import { type Logger } from '#/infra/logger/types';

import { type StorageAdapter } from './storage/types';

export type StoreOptions<TData> = {
    storage?: StorageAdapter<TData>;
    initialData?: TData;
    sanitize?: (value: unknown) => TData | null;
    logger?: Logger;
};

export type ReadableStore<TData> = {
    /** Current snapshot. `null` when uninitialized. */
    readonly value: TData | null;

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
export type Store<TData> = ReadableStore<TData> & {
    /** Replace the current snapshot and notify subscribers. Propagates a
     *  refused backing-store write so a caller that can retry does. */
    set(value: TData | null): void;

    /**
     * Non-throwing `set`. Replaces the snapshot, notifies subscribers, and
     * returns whether the value is durable.
     *
     * For callers with no survivable response to a throw: the tail of an
     * irreversible operation (a rollback that has already restored documents,
     * a delete that has already evicted one), and teardown paths whose
     * remaining steps must run. `false` means the session holds the value but
     * a reload will not.
     *
     * `true` requires the backing adapter to implement `StorageAdapter.trySet`
     * and say so. A store over an adapter that does not — Automerge-backed,
     * memory-backed — always reports `false`, because a returning `set` is not
     * evidence the value was committed anywhere.
     */
    trySet(value: TData | null): boolean;

    /** Atomic read-modify-write. */
    update(updater: (current: TData | null) => TData | null): void;

    /** Reset the store to `null` and clear backing storage. */
    clear(): void;

    /**
     * Hydrate the store from its backing storage without triggering a write-back.
     * Used after loading Automerge documents to populate the in-memory cache.
     */
    hydrate(): void;
};
