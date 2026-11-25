import { parse, stringify } from 'superjson';

import { logger } from '#/infra/logger/appLogger';
import { type LocalStorageKey, type LocalStoragePartKeyPrefix } from '#/infra/store/storage/LocalStorageKeys';

import { type LocalStorageAdapter } from './createLocalStorage';
import { reportStorageFullOnce } from './storageFullNotice';

/**
 * How one stored value divides into a small index and the parts it lists. Each part is stored under
 * its own key, so a write serializes only the parts whose objects changed since they were stored.
 */
export type LocalStoragePartition<TData, TIndex, TPart extends object> = {
    split(value: TData): { index: TIndex; parts: readonly TPart[] };
    join(index: TIndex, parts: TPart[]): TData;
    /** A part's identity, unique within one value; it names the key the part is stored under. */
    identify(part: TPart): string;
};

type CreatePartitionedLocalStorageOptions<TData, TIndex, TPart extends object> = {
    /** The key a whole-value `createLocalStorage` wrote. Read when present, removed by the next write. */
    legacyKey: LocalStorageKey;
    indexKey: LocalStorageKey;
    partKeyPrefix: LocalStoragePartKeyPrefix;
    partition: LocalStoragePartition<TData, TIndex, TPart>;
    /** As `createLocalStorage`'s option of the same name. */
    preserveSanitizedSourceWhen?: (value: unknown) => boolean;
};

type StoredIndex<TIndex> = { index: TIndex; ids: string[] };

/** The index text in storage and the part ids it names, in order. */
type IndexSnapshot = { text: string | null; ids: string[] };

/**
 * What one read found. A read is consistent only when the index parses, every part it names is
 * present and parses, and the index still reads the same after the parts: anything else is a
 * read taken while another writer (another tab, or a write a crash cut short) was changing it.
 */
type StoredRead<TData> = { consistent: true; value: TData | null } | { consistent: false };

/** A key a write changed and the text it held before, so a refused write can put it back. */
type ReplacedItem = { key: string; previousText: string | null };

function readIds(value: unknown): string[] {
    return Array.isArray(value) ? value.filter((id: unknown) => typeof id === 'string') : [];
}

function readIndexSnapshot(text: string | null): IndexSnapshot {
    if (text === null) {
        return { text, ids: [] };
    }
    try {
        return { text, ids: readIds(parse<{ ids?: unknown } | null>(text)?.ids) };
    } catch {
        return { text, ids: [] };
    }
}

function readStoredIds(stored: unknown): string[] | null {
    if (typeof stored !== 'object' || stored === null || !('ids' in stored) || !Array.isArray(stored.ids)) {
        return null;
    }
    const ids: unknown[] = stored.ids;
    return ids.every((id): id is string => typeof id === 'string') ? ids : null;
}

function readIndexedValue<TData, TIndex, TPart extends object>(
    indexKey: string,
    indexText: string | null,
    partition: LocalStoragePartition<TData, TIndex, TPart>,
    partKey: (id: string) => string
): StoredRead<TData> {
    if (indexText === null) {
        return { consistent: true, value: null };
    }
    let stored: StoredIndex<TIndex>;
    try {
        stored = parse<StoredIndex<TIndex>>(indexText);
    } catch {
        return { consistent: false };
    }
    const ids = readStoredIds(stored);
    if (ids === null) {
        return { consistent: false };
    }
    const parts: TPart[] = [];
    for (const id of ids) {
        const text = window.localStorage.getItem(partKey(id));
        if (text === null) {
            return { consistent: false };
        }
        try {
            parts.push(parse<TPart>(text));
        } catch {
            return { consistent: false };
        }
    }
    if (window.localStorage.getItem(indexKey) !== indexText) {
        return { consistent: false };
    }
    return { consistent: true, value: partition.join(stored.index, parts) };
}

/** The value older builds stored whole under `legacyKey` when present, since only they write it; otherwise the indexed one. */
function readLegacyOrIndexedValue<TData, TIndex, TPart extends object>(
    keys: { legacyKey: string; indexKey: string },
    indexText: string | null,
    partition: LocalStoragePartition<TData, TIndex, TPart>,
    partKey: (id: string) => string
): StoredRead<TData> {
    const legacyText = window.localStorage.getItem(keys.legacyKey);
    if (legacyText === null) {
        return readIndexedValue(keys.indexKey, indexText, partition, partKey);
    }
    try {
        return { consistent: true, value: parse<TData>(legacyText) };
    } catch {
        return { consistent: true, value: null };
    }
}

function readKeysWithPrefix(prefix: string): string[] {
    const keys: string[] = [];
    for (let index = 0; index < window.localStorage.length; index++) {
        const key = window.localStorage.key(index);
        if (key?.startsWith(prefix)) {
            keys.push(key);
        }
    }
    return keys;
}

function removeItems(keys: readonly string[]): void {
    for (const key of keys) {
        window.localStorage.removeItem(key);
    }
}

function reportDroppedWrite(key: string, error: unknown): void {
    logger.warn(
        `[localStorage] Dropped a write to "${key}". The value is live for this session but will not survive a reload.`,
        error
    );
    reportStorageFullOnce();
}

function isLocalStorageSupported(): boolean {
    try {
        return Boolean(window.localStorage);
    } catch {
        return false;
    }
}

/** Writes `text` under `key` unless it already holds it, recording what it replaced once it has. */
function replaceItem(key: string, text: string, replaced: ReplacedItem[]): void {
    const previousText = window.localStorage.getItem(key);
    if (previousText === text) {
        return;
    }
    window.localStorage.setItem(key, text);
    replaced.push({ key, previousText });
}

/** Removes `key` when it holds a value, recording that value so a refused write can put it back. */
function removeRecordedItem(key: string, replaced: ReplacedItem[]): void {
    const previousText = window.localStorage.getItem(key);
    if (previousText === null) {
        return;
    }
    window.localStorage.removeItem(key);
    replaced.push({ key, previousText });
}

/**
 * Puts back what a refused write replaced, newest first. Each restore puts back text the key
 * held a moment ago, so it needs no room the refused write had not already been granted; one
 * that still fails cannot be repaired here and is reported.
 */
function restoreReplacedItems(replaced: readonly ReplacedItem[]): void {
    for (const { key, previousText } of replaced.toReversed()) {
        try {
            if (previousText === null) {
                window.localStorage.removeItem(key);
            } else {
                window.localStorage.setItem(key, previousText);
            }
        } catch (error) {
            logger.error(
                new Error(`[localStorage] Could not restore "${key}" after a refused write`, { cause: error })
            );
        }
    }
}

/**
 * Removes the legacy value, then writes every changed part and then the index, or puts back what it
 * removed and wrote and rethrows. The legacy value goes first so a migration never holds the value
 * twice: near the quota, writing every part beside it would be refused on every save.
 */
function writePartsThenIndex<TPart extends object>(
    write: {
        parts: ReadonlyMap<string, TPart>;
        trustedParts: ReadonlyMap<string, TPart>;
        legacyKey: string;
        indexKey: string;
        indexText: string;
    },
    partKey: (id: string) => string
): void {
    const replaced: ReplacedItem[] = [];
    try {
        removeRecordedItem(write.legacyKey, replaced);
        for (const [id, part] of write.parts) {
            if (write.trustedParts.get(id) !== part) {
                replaceItem(partKey(id), stringify(part), replaced);
            }
        }
        replaceItem(write.indexKey, write.indexText, replaced);
    } catch (error) {
        restoreReplacedItems(replaced);
        throw error;
    }
}

function reportReadWhileChanging(key: string): void {
    logger.warn(
        `[localStorage] "${key}" was read while another writer was changing it; ` +
            'writes are refused until a reload reads it whole, so the stored value is kept.'
    );
}

/** The parts `value` holds by id, and the index text that names them in order. */
function planCommit<TData, TIndex, TPart extends object>(
    value: TData,
    partition: LocalStoragePartition<TData, TIndex, TPart>
): { nextParts: Map<string, TPart>; indexText: string } {
    const { index, parts } = partition.split(value);
    const nextParts = new Map(parts.map((part) => [partition.identify(part), part]));
    return { nextParts, indexText: stringify({ index, ids: [...nextParts.keys()] } satisfies StoredIndex<TIndex>) };
}

/**
 * A `localStorage` adapter that stores one value as an index key plus one key per part, so writing
 * a value that changed one part costs that part, not the whole value.
 *
 * A write replaces the changed parts' keys and then the index, the commit point. If any of those
 * writes is refused, every key the write had already replaced is put back as it was, so storage
 * again holds exactly the previously committed value and a reload restores it. Keys the new index
 * no longer names are removed only after it is written. A part's key is rewritten in place, as
 * `createLocalStorage` rewrites its one key, so a write needs no more room than the value it stores.
 *
 * A read taken while another writer was changing storage (an index naming a part that is missing
 * or does not parse, or an index that changed while the parts were read) reads as empty and makes
 * this adapter refuse every write, so a value built from that read never replaces or removes the
 * stored parts; the next adapter, after a reload, reads them again.
 *
 * A part is taken as unchanged when it is the very object this adapter last committed for its id,
 * so callers must replace a part rather than mutate it. Any other part is serialized and compared
 * with its stored text. Objects are trusted only while the stored index is the one this adapter
 * committed: once another writer replaced it, every part is compared with its stored text.
 */
export const createPartitionedLocalStorage = <TData, TIndex, TPart extends object>(
    options: CreatePartitionedLocalStorageOptions<TData, TIndex, TPart>
): LocalStorageAdapter<TData> => {
    const { legacyKey, indexKey, partKeyPrefix, partition } = options;
    let cachedValue: TData | null | undefined = undefined;
    /** The index this adapter last read or committed, and the part object it holds for each id. */
    let committed: { index: IndexSnapshot; parts: ReadonlyMap<string, TPart> } | null = null;
    /** Why this adapter refuses every write, while it holds a value it must not write back. */
    let writeRefusal: string | null = null;

    const partKey = (id: string): string => `${partKeyPrefix}${id}`;

    function readStoredValue(): TData | null {
        const indexText = window.localStorage.getItem(indexKey);
        committed = { index: readIndexSnapshot(indexText), parts: new Map() };
        const read = readLegacyOrIndexedValue({ legacyKey, indexKey }, indexText, partition, partKey);
        if (!read.consistent) {
            writeRefusal = 'was read while another writer was changing it';
            reportReadWhileChanging(indexKey);
            return null;
        }
        return read.value;
    }

    function removeEverything(): void {
        removeItems([...readKeysWithPrefix(partKeyPrefix), indexKey, legacyKey]);
        committed = { index: { text: null, ids: [] }, parts: new Map() };
    }

    /** Commits `value` durably, or throws leaving the previously committed value in storage. */
    function persist(value: TData | null): void {
        if (writeRefusal !== null) {
            throw new Error(`Local storage "${indexKey}" ${writeRefusal}`);
        }
        if (value === null) {
            removeEverything();
            cachedValue = null;
            return;
        }

        const storedIndex = readIndexSnapshot(window.localStorage.getItem(indexKey));
        const trustedParts = committed?.index.text === storedIndex.text ? committed.parts : new Map<string, TPart>();
        const { nextParts, indexText } = planCommit(value, partition);

        writePartsThenIndex({ parts: nextParts, trustedParts, legacyKey, indexKey, indexText }, partKey);

        const unnamedPartKeys = storedIndex.ids.filter((id) => !nextParts.has(id)).map(partKey);
        removeItems(unnamedPartKeys);
        committed = { index: { text: indexText, ids: [...nextParts.keys()] }, parts: nextParts };
        cachedValue = value;
    }

    const adapter: LocalStorageAdapter<TData> = {
        get(): TData | null {
            if (cachedValue === undefined) {
                cachedValue = readStoredValue();
            }
            return cachedValue;
        },

        // Propagates a refused write and keeps the cached value, as `createLocalStorage.set` does.
        set(value: TData | null): void {
            persist(value);
        },

        // Advances the cached value whether or not the write landed, as `createLocalStorage.trySet` does.
        trySet(value: TData | null): boolean {
            if (writeRefusal !== null) {
                return false;
            }
            try {
                persist(value);
                return true;
            } catch (error) {
                cachedValue = value;
                reportDroppedWrite(indexKey, error);
                return false;
            }
        },

        clear(): void {
            removeEverything();
            cachedValue = null;
            writeRefusal = null;
        },

        isSupported: isLocalStorageSupported,
    };

    if (options.preserveSanitizedSourceWhen) {
        adapter.setProjected = (value): void => {
            cachedValue = value;
            writeRefusal = 'contains a quarantined unsupported schema';
        };
        adapter.shouldProjectSanitizedSource = options.preserveSanitizedSourceWhen;
    }

    return adapter;
};
