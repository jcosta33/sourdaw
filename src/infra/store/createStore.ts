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
     * Returns whether the value is durable. Adapters that can refuse a write
     * implement `trySet` and report it themselves with the key they own;
     * the fallback here covers adapters that cannot (memory) and any that
     * throw for a reason no one anticipated.
     */
    const writeDurableValue = (value: TData | null): boolean => {
        const adapterTrySet = storage.trySet;
        if (adapterTrySet) {
            return adapterTrySet.call(storage, value);
        }

        try {
            storage.set(value);
            return true;
        } catch (error) {
            if (logger) {
                logger.error(new Error('Store write to backing storage failed', { cause: error }));
            }
            return false;
        }
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
     * view and nothing more: the content stays in the document, quarantined
     * rather than deleted. Writing it back would let a validator that cannot
     * recognise a row destroy it for every peer — including peers that read it
     * perfectly well — and a structural, version-blind validator cannot even
     * tell those rows from corrupt ones. On storage only this replica can see
     * there is no peer to lose and repairing it is the point, so the write-back
     * stands.
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
            queueStoreNotification(notify);
        },

        trySet(value: TData | null): boolean {
            const persisted = writeDurableValue(value);
            // Notify regardless: the visible value changed either way, and a
            // caller that keeps rendering the pre-write snapshot because the
            // write was not durable is a second failure on top of the first.
            queueStoreNotification(notify);
            return persisted;
        },

        update(updater: (current: TData | null) => TData | null): void {
            store.set(updater(storage.get()));
        },

        clear(): void {
            storage.clear();
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
