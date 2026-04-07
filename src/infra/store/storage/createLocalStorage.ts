import { stringify, parse } from 'superjson';
import { type LocalStorageKey } from '#/helpers/Store/Storage/LocalStorageKeys';
import { type StorageAdapter } from './types';

export const createLocalStorage = <TData>(key: LocalStorageKey): StorageAdapter<TData> => {
    let cachedValue: TData | null | undefined = undefined;

    return {
        get(): TData | null {
            if (cachedValue !== undefined) {
                return cachedValue;
            }

            const raw = localStorage.getItem(key);
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
                localStorage.removeItem(key);
                return;
            }

            localStorage.setItem(key, stringify(value));
        },

        clear(): void {
            cachedValue = null;
            localStorage.removeItem(key);
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
