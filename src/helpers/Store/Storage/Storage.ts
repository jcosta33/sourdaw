/* (c) Copyright Sourdaw Ltd., all rights reserved. */

export type Storage<TDataSchema> = {
    get(): TDataSchema | null;
    set(value: TDataSchema | null): void;
    clear(): void;
    isSupported(): boolean;
    /** Hydrate the cache from the backing store without triggering a write-back.
     *  Returns true if the cached value changed. */
    hydrate?(): boolean;
}
