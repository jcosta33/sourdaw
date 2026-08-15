import { logger as appLogger } from '#/infra/logger/appLogger';

import { createMemoryStorage } from './storage/createMemoryStorage';
import { type Store, type StoreOptions } from './types';

let storeBatchDepth = 0;
let flushingStoreNotifications = false;
const pendingStoreNotifications = new Set<() => void>();

function queueStoreNotification(notify: () => void): void {
    if (storeBatchDepth > 0 || flushingStoreNotifications) {
        pendingStoreNotifications.add(notify);
        return;
    }
    notify();
}

function flushStoreNotifications(): void {
    if (flushingStoreNotifications) {
        return;
    }
    flushingStoreNotifications = true;
    try {
        while (pendingStoreNotifications.size > 0) {
            const notify = pendingStoreNotifications.values().next().value;
            if (!notify) {
                break;
            }
            pendingStoreNotifications.delete(notify);
            notify();
        }
    } finally {
        flushingStoreNotifications = false;
    }
}

export function batchStoreUpdates<TResult>(update: () => TResult): TResult {
    storeBatchDepth++;
    try {
        return update();
    } finally {
        storeBatchDepth--;
        if (storeBatchDepth === 0) {
            flushStoreNotifications();
        }
    }
}

export const createStore = <TData>(options: StoreOptions<TData> = {}): Store<TData> => {
    const logger = options.logger;
    const storageCandidate = options.storage;
    const storage = storageCandidate?.isSupported() ? storageCandidate : createMemoryStorage<TData>();
    const sanitize = options.sanitize;
    if (sanitize) {
        storage.registerInboundSanitizer?.(sanitize);
    }

    /**
     * Write without letting a refused backing store unwind the caller.
     *
     * Every store declared at module scope runs its constructor during ES
     * module evaluation, and the constructor writes: it seeds an empty backing
     * store, and it repairs one holding content this build sanitized. A throw
     * from either aborts the module graph before the composition root exists,
     * so nothing in the app can catch it and the app does not boot — which a
     * full origin quota, or Safari private mode's outright `SecurityError` from
     * `setItem`, is enough to cause. See #1557.
     *
     * Returns whether the value is DURABLE — committed to a backing store that
     * outlives the session — which is the question every caller of the boolean
     * actually acts on.
     *
     * An adapter that does not implement `trySet` has made no durability claim,
     * so this reports `false` rather than inventing one. A returning `set` is
     * not evidence of durability and this used to treat it as if it were:
     *
     * - `createAutomergeStorage.set` only records a pending write that a
     *   later `preparePendingWrite` can `abandon`, rolling the store back to
     *   the last committed value. Nothing has reached the document at the
     *   moment of the call, and it may never.
     * - `createMemoryStorage` has no backing store to outlive anything.
     * - `createVersionControlStorage` swallows its own write failures
     *   internally, so it cannot report on them at all.
     *
     * `false` is accurate for all three. Adapters that can genuinely answer —
     * `createLocalStorage`, `createPlainJsonLocalStorage` — opt in and report
     * for themselves, naming the key they own.
     *
     * The fallback reports through the module logger, not `options.logger`.
     * `options.logger` is optional and no production call site passes one, so
     * gating the only signal a dropped write produces on it would mean the
     * fallback drops writes silently everywhere it actually runs — and the test
     * proving it reports would be proving a configuration that does not ship.
     */
    const writeDurableValue = (value: TData | null): boolean => {
        const adapterTrySet = storage.trySet;
        if (adapterTrySet) {
            return adapterTrySet.call(storage, value);
        }

        try {
            storage.set(value);
        } catch (error) {
            appLogger.error(new Error('Store write to backing storage failed', { cause: error }));
        }

        return false;
    };

    /**
     * Apply the sanitizer to a value arriving from backing storage.
     *
     * Sanitizing runs on inbound paths only — the initial seed and post-hydrate
     * — so it is a guard against data this build cannot read, never a review of
     * what this build just wrote.
     *
     * What happens to the rejected content depends on who else can see the
     * backing store. On a shared document the sanitized result governs the read
     * view and nothing more: the content stays quarantined rather than deleted.
     * Writing it back would let a validator that cannot recognise a row destroy
     * it for every peer — including peers that read it perfectly well. A
     * versioned local store may opt into the same projection boundary so an
     * older build cannot erase a newer schema. Other local storage repairs the
     * backing value because there is no peer or future-schema owner to lose.
     */
    const sanitizeStorageValue = (value: TData | null): boolean => {
        if (!sanitize) {
            return false;
        }

        let sanitized: TData | null;
        try {
            sanitized = sanitize(value);
        } catch (error) {
            if (logger) {
                logger.error(new Error('Store sanitization failed', { cause: error }));
            }
            sanitized = options.initialData ?? null;
        }

        if (Object.is(sanitized, value)) {
            return false;
        }

        const setProjected = storage.setProjected;
        if (setProjected) {
            if (logger) {
                logger.warn(
                    'Store content this build cannot read was quarantined: withheld from readers, left intact in shared storage.'
                );
            }
            setProjected.call(storage, sanitized);
            return true;
        }

        writeDurableValue(sanitized);
        return true;
    };

    // Seed initial data if the storage is empty
    const storedValue = storage.get();
    if (storedValue === null) {
        if (options.initialData !== undefined) {
            writeDurableValue(options.initialData);
        }
    } else {
        sanitizeStorageValue(storedValue);
    }

    const subscribers = new Set<(value: TData | null) => void>();
    const reactListeners = new Set<() => void>();

    const notify = (): void => {
        const current = storage.get();

        for (const callback of subscribers) {
            try {
                callback(current);
            } catch (error) {
                if (logger) {
                    logger.error(new Error('Error while notifying changes in store', { cause: error }));
                }
            }
        }

        for (const listener of reactListeners) {
            try {
                listener();
            } catch (error) {
                if (logger) {
                    logger.error(new Error('Error while notifying React listener in store', { cause: error }));
                }
            }
        }
    };

    const store: Store<TData> = {
        get value(): TData | null {
            return storage.get();
        },

        set(value: TData | null): void {
            storage.set(value);
            if (storage.isIsolated?.()) {
                return;
            }
            queueStoreNotification(notify);
        },

        trySet(value: TData | null): boolean {
            const persisted = writeDurableValue(value);
            // Notify regardless: the visible value changed either way, and a
            // caller that keeps rendering the pre-write snapshot because the
            // write was not durable is a second failure on top of the first.
            //
            // Known consequence, recorded rather than guarded. A subscriber can
            // carry a non-durable value further than this replica: during a
            // collaboration session `startBranchSync` mutates the `__branches__`
            // Automerge doc on every `branchStore` notification, so a rolled-back
            // branch list that `localStorage` refused is still broadcast to peers
            // and written into the persisted bundle. The throwing `set` would
            // have thrown before notifying. It is bounded — the host is
            // authoritative for that document and `stopBranchSync` removes it —
            // and the alternative, withholding the notification, leaves every
            // reader on a value the writer has already moved past. See #1557.
            queueStoreNotification(notify);
            return persisted;
        },

        update(updater: (current: TData | null) => TData | null): void {
            store.set(updater(storage.get()));
        },

        clear(): void {
            storage.clear();
            if (storage.isIsolated?.()) {
                return;
            }
            queueStoreNotification(notify);
        },

        hydrate(): void {
            if (storage.hydrate) {
                let changed: boolean;
                try {
                    changed = storage.hydrate();
                } catch (error) {
                    if (logger) {
                        logger.error(new Error('Store hydration failed', { cause: error }));
                    }
                    return;
                }
                if (changed) {
                    sanitizeStorageValue(storage.get());
                    queueStoreNotification(notify);
                }
            }
        },

        subscribe(callback: (value: TData | null) => void): () => void {
            subscribers.add(callback);
            return () => {
                subscribers.delete(callback);
            };
        },

        subscribeReact(listener: () => void): () => void {
            reactListeners.add(listener);
            return () => {
                reactListeners.delete(listener);
            };
        },

        getSnapshot(): TData | null {
            return storage.get();
        },
    };

    // Deferred storage-side visibility changes (e.g. a rAF-batched CRDT write
    // committing after an interleaved hydrate) must reach subscribers too —
    // otherwise the UI keeps rendering the pre-commit snapshot while
    // getSnapshot() already returns the committed value.
    storage.subscribe?.(() => {
        queueStoreNotification(notify);
    });

    return store;
};
