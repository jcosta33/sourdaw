/* (c) Copyright Sourdaw Ltd., all rights reserved. */

import { stringify, parse } from 'superjson';

import { type LocalStorageKey } from './LocalStorageKeys';
import { type Storage } from './Storage';

export class LocalStorageStorage<TDataSchema> implements Storage<TDataSchema> {
    readonly #key: LocalStorageKey;
    #cachedValue: TDataSchema | null | undefined = undefined;

    constructor(key: LocalStorageKey) {
        this.#key = key;
    }

    get(): TDataSchema | null {
        if (this.#cachedValue !== undefined) {
            return this.#cachedValue;
        }

        const value = localStorage.getItem(this.#key);

        if (value === null) {
            this.#cachedValue = null;
            return null;
        }

        try {
            this.#cachedValue = parse<TDataSchema>(value);
        } catch {
            this.#cachedValue = value as TDataSchema;
        }

        return this.#cachedValue;
    }

    set(value: TDataSchema | null): void {
        this.#cachedValue = value;

        if (value === null) {
            this.clear();
            return;
        }
        localStorage.setItem(this.#key, stringify(value));
    }

    clear(): void {
        this.#cachedValue = null;
        localStorage.removeItem(this.#key);
    }

    isSupported(): boolean {
        try {
            return Boolean(window.localStorage);
        } catch {
            return false;
        }
    }
}
