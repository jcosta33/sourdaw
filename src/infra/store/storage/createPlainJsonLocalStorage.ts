import { logger } from '#/infra/logger/appLogger';
import { type LocalStorageKey } from '#/infra/store/storage/LocalStorageKeys';

import { type StorageAdapter } from './types';

type CreatePlainJsonLocalStorageInput<TData> = {
    key: LocalStorageKey;
    decode: (value: unknown) => TData | null;
};

const readPlainJsonValue = <TData>(input: CreatePlainJsonLocalStorageInput<TData>): TData | null => {
    try {
        // eslint-disable-next-line no-restricted-syntax -- This storage adapter is the sanctioned boundary for legacy plain-JSON localStorage keys.
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

    function persist(value: TData | null): void {
        cachedValue = value;
        hasCachedValue = true;

        if (value === null) {
            // eslint-disable-next-line no-restricted-syntax -- This storage adapter is the sanctioned boundary for legacy plain-JSON localStorage keys.
            window.localStorage.removeItem(input.key);
            return;
        }

        const serialized = JSON.stringify(value);

        // eslint-disable-next-line no-restricted-syntax -- This storage adapter is the sanctioned boundary for legacy plain-JSON localStorage keys.
        window.localStorage.setItem(input.key, serialized);
    }

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
            persist(value);
        },

        // See `StorageAdapter.trySet`. This adapter already advances its cache
        // ahead of the durable write, so the only thing `trySet` adds over
        // `set` is that the caller is told the write was dropped instead of
        // being unwound by a throw it cannot answer.
        trySet(value: TData | null): boolean {
            try {
                persist(value);
                return true;
            } catch (error) {
                logger.warn(
                    `[localStorage] Dropped a write to "${input.key}". ` +
                        'The value is live for this session but will not survive a reload.',
                    error
                );
                return false;
            }
        },

        clear(): void {
            cachedValue = null;
            hasCachedValue = true;
            // eslint-disable-next-line no-restricted-syntax -- This storage adapter is the sanctioned boundary for legacy plain-JSON localStorage keys.
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
