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
            cachedValue = value;

            if (value === null) {
                window.localStorage.removeItem(key);
                return;
            }

            window.localStorage.setItem(key, stringify(value));
        },

        clear(): void {
            cachedValue = null;
            window.localStorage.removeItem(key);
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
