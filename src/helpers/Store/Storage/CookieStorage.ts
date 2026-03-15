/* (c) Copyright Frontify Ltd., all rights reserved. */

import { Cookie } from 'Utility/Cookie';

import { type Storage } from './Storage';

type Options = {
    sameSite?: 'Lax' | 'Strict' | 'None';
    path?: string;
    domain?: string;
    validityDate?: Date;
};

export class CookieStorage<TCookieSchema> implements Storage<TCookieSchema> {
    #cachedValue: TCookieSchema | null | undefined = undefined;
    readonly #key: string;
    readonly #options?: Options;

    constructor(key: string, options?: Options) {
        this.#key = key;
        this.#options = options;
    }

    get(): TCookieSchema | null {
        if (this.#cachedValue !== undefined) {
            return this.#cachedValue;
        }

        try {
            return JSON.parse(Cookie.get(this.#key) || 'null') as TCookieSchema;
        } catch {
            return null;
        }
    }

    set(value: TCookieSchema): void {
        this.#cachedValue = value;
        Cookie.set(this.#key, JSON.stringify(value), {
            expires: this.#options?.validityDate,
            sameSite: this.#options?.sameSite,
            path: this.#options?.path,
            domain: this.#options?.domain,
        });
    }

    clear(): void {
        this.#cachedValue = null;
        Cookie.remove(this.#key);
    }

    isSupported(): boolean {
        try {
            const key = '__cookie_support_test__';

            Cookie.set(key, 'supported');
            const isSupported = Cookie.isSet(key);
            Cookie.remove(key);

            return isSupported;
        } catch {
            return false;
        }
    }
}
