/* (c) Copyright Frontify Ltd., all rights reserved. */

import { stringify, parse } from 'superjson';

import { type SessionStorageKey } from './SessionStorageKeys';
import { type Storage } from './Storage';

export class SessionStorageStorage<TDataSchema> implements Storage<TDataSchema> {
    readonly #key: SessionStorageKey;
    #cachedValue: TDataSchema | null | undefined = undefined;

    constructor(key: SessionStorageKey) {
        this.#key = key;
    }

    get(): TDataSchema | null {
        if (this.#cachedValue !== undefined) {
            return this.#cachedValue;
        }

        const value = sessionStorage.getItem(this.#key);

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
        sessionStorage.setItem(this.#key, stringify(value));
    }

    clear(): void {
        this.#cachedValue = null;
        sessionStorage.removeItem(this.#key);
    }

    isSupported(): boolean {
        try {
            return Boolean(window.sessionStorage);
        } catch {
            return false;
        }
    }
}
