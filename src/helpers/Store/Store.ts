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
