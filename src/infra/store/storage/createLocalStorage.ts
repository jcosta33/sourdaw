import { stringify, parse } from 'superjson';

import { logger } from '#/infra/logger/appLogger';
import { type LocalStorageKey } from '#/infra/store/storage/LocalStorageKeys';

import { reportStorageFullOnce } from './storageFullNotice';
import { type StorageAdapter } from './types';

/**
 * Size the rejected payload so the log names both the key that could not be
 * written and how much it was asking for. On a full origin the individual
 * failure is noise — which key is eating the quota is the answer worth having,
 * and no other layer knows both facts at once.
 */
function describeRejectedPayload<TData>(value: TData | null): string {
    if (value === null) {
        return 'a removal';
    }

    try {
        return `${stringify(value).length} chars`;
    } catch {
        return 'an unserializable value';
    }
}

/**
 * `StorageAdapter` narrowed to guarantee `trySet`, so a caller holding the
 * adapter directly — rather than through a `Store` — does not have to prove it
 * exists before using the only write this backing store cannot refuse.
 */
export type LocalStorageAdapter<TData> = StorageAdapter<TData> & {
    trySet(value: TData | null): boolean;
};

type CreateLocalStorageOptions = {
    /**
     * Keep sanitizer-rejected source bytes durable while exposing only the
     * sanitized projection to this build. Versioned stores use this to avoid
     * destroying state written by a newer application version.
     */
    preserveSanitizedSource?: boolean;
};

export const createLocalStorage = <TData>(
    key: LocalStorageKey,
    options?: CreateLocalStorageOptions
): LocalStorageAdapter<TData> => {
    let cachedValue: TData | null | undefined = undefined;

    /** Write through to the backing store, advancing the cache only once durable. */
    function persist(value: TData | null): void {
        if (value === null) {
            window.localStorage.removeItem(key);
            cachedValue = null;
            return;
        }

        window.localStorage.setItem(key, stringify(value));
        cachedValue = value;
    }

    const adapter: LocalStorageAdapter<TData> = {
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

        // Deliberately propagates a failed write, and only advances the cache
        // once the value is durable — so `get()` never reports something that
        // is not persisted, and a caller can retry. Pinned by "keeps the cached
        // value when setItem fails and retries persistence" in this adapter's
        // spec. Callers that cannot survive a throw call `trySet` instead.
        set(value: TData | null): void {
            persist(value);
        },

        // The non-throwing counterpart, for callers that have no survivable
        // response to a throw: module evaluation (a throw there aborts the ES
        // module graph before any app-level catch exists), and the tail of an
        // irreversible operation, where aborting abandons work already done.
        //
        // The cache semantics are deliberately the inverse of `set`. `set`
        // preserves the old cached value so a retry is meaningful; `trySet`
        // advances it whether or not the write landed, because its callers are
        // not going to retry — they need the new value live in this session,
        // and the return value is how they learn it is not durable. Silently
        // keeping the stale value instead would leave readers on data the
        // caller has already moved past.
        trySet(value: TData | null): boolean {
            try {
                persist(value);
                return true;
            } catch (error) {
                cachedValue = value;
                logger.warn(
                    `[localStorage] Dropped a write to "${key}" (${describeRejectedPayload(value)}). ` +
                        'The value is live for this session but will not survive a reload.',
                    error
                );
                reportStorageFullOnce();
                return false;
            }
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

    if (options?.preserveSanitizedSource === true) {
        adapter.setProjected = (value): void => {
            cachedValue = value;
        };
    }

    return adapter;
};
