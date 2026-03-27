/* (c) Copyright Sourdaw Ltd., all rights reserved. */

import { type Storage } from './Storage';

export class MemoryStorage<TDataSchema> implements Storage<TDataSchema> {
    private value: TDataSchema | null = null;

    get(): TDataSchema | null {
        return this.value;
    }

    set(value: TDataSchema | null): void {
        this.value = value;
    }

    clear(): void {
        this.value = null;
    }

    isSupported() {
        return true;
    }
}
