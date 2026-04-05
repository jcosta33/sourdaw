/* (c) Copyright Sourdaw Ltd., all rights reserved. */

import { type Logger } from '../Logger/Logger';

import { MemoryStorage } from './Storage/MemoryStorage';
import { type Storage } from './Storage/Storage';

type StoreOptions<TDataSchema> = {
    storage?: Storage<TDataSchema>;
    initialData?: TDataSchema;
};

export class Store<TDataSchema> {
    readonly #subscribers = new Set<(value: TDataSchema | null) => void>();
    readonly #storage: Storage<TDataSchema>;
    readonly #logger: Logger;

    constructor(logger: Logger, options: StoreOptions<TDataSchema> = {}) {
        this.#logger = logger;
        this.#storage = options.storage?.isSupported() ? options.storage : new MemoryStorage();
        if (options.initialData && this.#storage.get() === null) {
            this.#storage.set(options.initialData);
        }
    }

    get value(): TDataSchema | null {
        return this.#storage.get();
    }

    set(value: TDataSchema | null): void {
        this.#storage.set(value);
        this.#notify();
    }

    /**
     * Atomic read-modify-write. Applies `updater` to the current value and
     * writes the result back. Use this instead of `store.set({ ...store.value, x })`
     * to avoid repeating the spread at every call site and to make the
     * read-then-write intent explicit.
     */
    update(updater: (current: TDataSchema | null) => TDataSchema | null): void {
        this.set(updater(this.value));
    }

    subscribe(callback: (value: TDataSchema | null) => void): () => void {
        this.#subscribers.add(callback);

        return () => {
            this.#subscribers.delete(callback);
        };
    }

    clear(): void {
        this.#storage.clear();
        this.#notify();
    }

    /**
     * Hydrate the store from its backing storage without triggering a write-back.
     * Used after loading Automerge documents to populate the in-memory cache
     * and notify subscribers of the loaded state.
     */
    hydrate(): void {
        if (this.#storage.hydrate) {
            let changed: boolean;
            try {
                changed = this.#storage.hydrate();
            } catch (error) {
                this.#logger.error(new Error('Store hydration failed', { cause: error }));
                return;
            }
            if (changed) {
                this.#notify();
            }
        }
    }

    #notify(): void {
        const value = this.value;

        for (const callback of this.#subscribers) {
            try {
                callback(value);
            } catch (error) {
                this.#logger.error(new Error('Error while notifying changes in store', { cause: error }));
            }
        }
    }
}
