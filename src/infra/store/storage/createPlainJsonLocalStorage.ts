import { type LocalStorageKey } from '#/infra/store/storage/LocalStorageKeys';

import { type StorageAdapter } from './types';

type CreatePlainJsonLocalStorageInput<TData> = {
    key: LocalStorageKey;
    decode: (value: unknown) => TData | null;
};

const readPlainJsonValue = <TData>(input: CreatePlainJsonLocalStorageInput<TData>): TData | null => {
    try {
        const raw = window.localStorage.getItem(input.key);
        if (raw === null) {
            return null;
        }

        const parsed: unknown = JSON.parse(raw);
        return input.decode(parsed);
    } catch {
        return null;
    }
};

export const createPlainJsonLocalStorage = <TData>(
    input: CreatePlainJsonLocalStorageInput<TData>
): StorageAdapter<TData> => {
    let hasCachedValue = false;
    let cachedValue: TData | null = null;

    return {
        get(): TData | null {
            if (hasCachedValue) {
                return cachedValue;
            }

            cachedValue = readPlainJsonValue(input);
            hasCachedValue = true;
            return cachedValue;
        },

        set(value: TData | null): void {
            cachedValue = value;
            hasCachedValue = true;

            if (value === null) {
                window.localStorage.removeItem(input.key);
                return;
            }

            const serialized = JSON.stringify(value);
            if (serialized === undefined) {
                window.localStorage.removeItem(input.key);
                cachedValue = null;
                return;
            }

            window.localStorage.setItem(input.key, serialized);
        },

        clear(): void {
            cachedValue = null;
            hasCachedValue = true;
            window.localStorage.removeItem(input.key);
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
