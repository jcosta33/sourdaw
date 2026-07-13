import { stringify, parse } from 'superjson';

import { type LocalStorageKey } from '#/infra/store/storage/LocalStorageKeys';

import { type StorageAdapter } from './types';

export const createLocalStorage = <TData>(key: LocalStorageKey): StorageAdapter<TData> => {
    let cachedValue: TData | null | undefined = undefined;

    return {
        get(): TData | null {
            if (cachedValue !== undefined) {
                return cachedValue;
            }

            const raw = window.localStorage.getItem(key);
            if (raw === null) {
                cachedValue = null;
                return null;
            }

            try {
                cachedValue = parse<TData>(raw);
            } catch {
                cachedValue = raw as TData;
            }

            return cachedValue;
        },

        set(value: TData | null): void {
            if (value === null) {
                window.localStorage.removeItem(key);
                cachedValue = null;
                return;
            }

            window.localStorage.setItem(key, stringify(value));
            cachedValue = value;
        },

        clear(): void {
            window.localStorage.removeItem(key);
            cachedValue = null;
        },

        isSupported(): boolean {
            try {
                return Boolean(window.localStorage);
            } catch {
                return false;
            }
        },
    };
};
