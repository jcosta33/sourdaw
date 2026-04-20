import { createMemoryStorage } from './storage/createMemoryStorage';
import { type Store, type StoreOptions } from './types';

export const createStore = <TData>(options: StoreOptions<TData> = {}): Store<TData> => {
    const logger = options.logger;
    const storageCandidate = options.storage;
    const storage = storageCandidate?.isSupported() ? storageCandidate : createMemoryStorage<TData>();

    // Seed initial data if the storage is empty
    if (options.initialData !== undefined && storage.get() === null) {
        storage.set(options.initialData);
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
            notify();
        },

        update(updater: (current: TData | null) => TData | null): void {
            store.set(updater(storage.get()));
        },

        clear(): void {
            storage.clear();
            notify();
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
                    notify();
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

    return store;
};
