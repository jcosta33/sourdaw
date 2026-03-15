/* (c) Copyright Frontify Ltd., all rights reserved. */

import { type Logger } from '../Logger/Logger';

import { MemoryStorage } from './Storage/MemoryStorage';
import { type Storage } from './Storage/Storage';

type ReadonlyStoreOptions<TDataSchema> = {
    storage: Storage<TDataSchema>;
    getDataFn?: (() => TDataSchema | null) | (() => Promise<TDataSchema | null>);
};

export class ReadonlyStore<TDataSchema> {
    readonly #subscribers = new Set<(value: TDataSchema | null) => void>();
    readonly #logger: Logger;
    readonly #storage: Storage<TDataSchema>;
    readonly #getDataFn: ReadonlyStoreOptions<TDataSchema>['getDataFn'];
    #abortController: AbortController | null = null;

    constructor(logger: Logger, options: ReadonlyStoreOptions<TDataSchema>) {
        this.#logger = logger;
        this.#storage = options.storage;
        this.#getDataFn = options.getDataFn;
    }

    public static async create<TDataSchema>(
        logger: Logger,
        options: ReadonlyStoreOptions<TDataSchema> = { storage: new MemoryStorage() }
    ): Promise<ReadonlyStore<TDataSchema>> {
        const store = new ReadonlyStore<TDataSchema>(logger, options);

        if (store.#getDataFn) {
            await store.refresh();
        }

        return store;
    }

    get value(): TDataSchema | null {
        return this.#storage.get();
    }

    subscribe(callback: (value: TDataSchema | null) => void): () => void {
        this.#subscribers.add(callback);

        return () => {
            this.#subscribers.delete(callback);
        };
    }

    async refresh(): Promise<void> {
        if (this.#getDataFn) {
            if (this.#abortController) {
                this.#abortController.abort();
            }

            this.#abortController = new AbortController();
            const { signal } = this.#abortController;

            try {
                const result = this.#getDataFn();
                if (result instanceof Promise) {
                    if (signal.aborted) {
                        return;
                    }

                    const value = await result;

                    // Again check if aborted after await
                    // (it is possible that the promise is resolved before an abort)
                    if (signal.aborted) {
                        return;
                    }

                    this.#storage.set(value);
                    this.#notify();
                } else {
                    this.#storage.set(result);
                    this.#notify();
                }
            } catch (error) {
                // Only log error if not aborted
                if (!signal.aborted) {
                    this.#logger.error(new Error('Error while refreshing store', { cause: error }));
                }
            } finally {
                if (this.#abortController?.signal === signal) {
                    this.#abortController = null;
                }
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
