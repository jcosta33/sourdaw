/* (c) Copyright Sourdaw Ltd., all rights reserved. */

export interface Storage<TDataSchema> {
    get(): TDataSchema | null;
    set(value: TDataSchema | null): void;
    clear(): void;
    isSupported(): boolean;
}
