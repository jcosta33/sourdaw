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

/** A part as this adapter last read or committed it: the object, and the text its key held then. */
type CommittedPart<TPart> = { part: TPart; text: string };

type CommittedParts<TPart> = ReadonlyMap<string, CommittedPart<TPart>>;

/**
 * What one read found. A read is consistent when the index parses and reads the same after its
 * parts; a part it names that is missing or does not parse is left out and listed in `droppedIds`.
 * An index that changed while its parts were read is a read taken while another writer was
 * committing, and is not consistent.
 */
type StoredRead<TData, TPart> =
    | { consistent: true; value: TData | null; parts: Map<string, CommittedPart<TPart>>; droppedIds: string[] }
    | { consistent: false };

/** The parts a value holds by id, and the index text that names them in order. */
type CommitPlan<TPart> = { parts: ReadonlyMap<string, TPart>; indexText: string };

type StorageKeys = {
    legacyKey: string;
    indexKey: string;
    partKeyPrefix: string;
    partKey: (id: string) => string;
};

/** A key a write changed and the text it held before, so a refused write can put it back. */
type ReplacedItem = { key: string; previousText: string | null };

function readStorageKeys(options: { legacyKey: string; indexKey: string; partKeyPrefix: string }): StorageKeys {
    const { legacyKey, indexKey, partKeyPrefix } = options;
    return { legacyKey, indexKey, partKeyPrefix, partKey: (id) => `${partKeyPrefix}${id}` };
}

function readStoredIds(stored: unknown): string[] | null {
    if (typeof stored !== 'object' || stored === null || !('ids' in stored) || !Array.isArray(stored.ids)) {
        return null;
    }
    const ids: unknown[] = stored.ids;
    return ids.every((id): id is string => typeof id === 'string') ? ids : null;
}

function readIndexedValue<TData, TIndex, TPart extends object>(
    keys: StorageKeys,
    indexText: string | null,
    partition: LocalStoragePartition<TData, TIndex, TPart>
): StoredRead<TData, TPart> {
    if (indexText === null) {
        return { consistent: true, value: null, parts: new Map(), droppedIds: [] };
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
    const parts = new Map<string, CommittedPart<TPart>>();
    const droppedIds: string[] = [];
    for (const id of ids) {
        const text = window.localStorage.getItem(keys.partKey(id));
        if (text === null) {
            droppedIds.push(id);
            continue;
        }
        try {
            parts.set(id, { part: parse<TPart>(text), text });
        } catch {
            droppedIds.push(id);
        }
    }
    if (window.localStorage.getItem(keys.indexKey) !== indexText) {
        return { consistent: false };
    }
    const value = partition.join(
        stored.index,
        Array.from(parts.values(), (entry) => entry.part)
    );
    return { consistent: true, value, parts, droppedIds };
}

/** The value older builds stored whole under the legacy key when present, since only they write it; otherwise the indexed one. */
function readLegacyOrIndexedValue<TData, TIndex, TPart extends object>(
    keys: StorageKeys,
    partition: LocalStoragePartition<TData, TIndex, TPart>
): StoredRead<TData, TPart> {
    const legacyText = window.localStorage.getItem(keys.legacyKey);
    if (legacyText === null) {
        return readIndexedValue(keys, window.localStorage.getItem(keys.indexKey), partition);
    }
    let value: TData | null;
    try {
        value = parse<TData>(legacyText);
    } catch {
        value = null;
    }
    return { consistent: true, value, parts: new Map(), droppedIds: [] };
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

function reportReadWhileChanging(key: string): void {
    logger.warn(
        `[localStorage] "${key}" was read while another writer was changing it; ` +
            'writes are refused until a reload reads it whole, so the stored value is kept.'
    );
}

function reportDroppedParts(key: string, droppedIds: readonly string[]): void {
    logger.warn(
        `[localStorage] "${key}" names ${String(droppedIds.length)} part(s) that are missing or do not parse; ` +
            'the other parts are read, and the next write leaves these out.'
    );
}

function isLocalStorageSupported(): boolean {
    try {
        return Boolean(window.localStorage);
    } catch {
        return false;
    }
}

function isQuotaError(error: unknown): boolean {
    return error instanceof DOMException && error.name === 'QuotaExceededError';
}

function planCommit<TData, TIndex, TPart extends object>(
    value: TData,
    partition: LocalStoragePartition<TData, TIndex, TPart>
): CommitPlan<TPart> {
    const { index, parts } = partition.split(value);
    const nextParts = new Map(parts.map((part) => [partition.identify(part), part]));
    return {
        parts: nextParts,
        indexText: stringify({ index, ids: [...nextParts.keys()] } satisfies StoredIndex<TIndex>),
    };
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

/** The ids the stored index names, or none when it is missing or does not parse. */
function readIndexedIds(keys: StorageKeys): string[] {
    const indexText = window.localStorage.getItem(keys.indexKey);
    if (indexText === null) {
        return [];
    }
    try {
        return readStoredIds(parse(indexText)) ?? [];
    } catch {
        return [];
    }
}

/**
 * Removes the parts the stored index names that the plan drops, before any part is written, so a
 * write at the count bound needs room for the parts it keeps and adds, not also those it evicts. A
 * stop after this leaves an index naming a missing part, which a read leaves out.
 */
function removeEvictedParts<TPart>(plan: CommitPlan<TPart>, keys: StorageKeys, replaced: ReplacedItem[]): void {
    for (const id of readIndexedIds(keys)) {
        if (!plan.parts.has(id)) {
            removeRecordedItem(keys.partKey(id), replaced);
        }
    }
}

/**
 * Frees the parts the plan evicts, writes every part not committed as it stands and then the index,
 * recording what it replaced, and returns the parts it committed. A committed part is the very
 * object this adapter last read or wrote for its id; another writer's change to its key is learned
 * from the `storage` event, which forgets that entry.
 */
function writePartsThenIndex<TPart extends object>(
    plan: CommitPlan<TPart>,
    committed: CommittedParts<TPart>,
    keys: StorageKeys,
    replaced: ReplacedItem[]
): Map<string, CommittedPart<TPart>> {
    removeEvictedParts(plan, keys, replaced);
    const written = new Map<string, CommittedPart<TPart>>();
    for (const [id, part] of plan.parts) {
        const entry = committed.get(id);
        if (entry?.part === part) {
            written.set(id, entry);
            continue;
        }
        const text = stringify(part);
        replaceItem(keys.partKey(id), text, replaced);
        written.set(id, { part, text });
    }
    replaceItem(keys.indexKey, plan.indexText, replaced);
    return written;
}

/** Where a commit left the value: indexed, with the parts it committed, or whole under the legacy key. */
type CommitResult<TPart> = { kind: 'indexed'; parts: Map<string, CommittedPart<TPart>> } | { kind: 'legacy' };

/**
 * Commits a plan through the index, keeping the legacy value until the index is written, so a stop
 * anywhere before that still reads the legacy value. When storage has no room for the parts beside
 * the legacy value, every key the attempt changed is put back and the whole value replaces the
 * legacy one in a single write, so a stop reads either value whole; migration waits for a later
 * write. When that write is refused too, the legacy value stays byte for byte and the error is thrown.
 */
function commitPlan<TPart extends object>(
    value: unknown,
    plan: CommitPlan<TPart>,
    committed: CommittedParts<TPart>,
    keys: StorageKeys
): CommitResult<TPart> {
    const replaced: ReplacedItem[] = [];
    try {
        return { kind: 'indexed', parts: writePartsThenIndex(plan, committed, keys, replaced) };
    } catch (error) {
        restoreReplacedItems(replaced);
        if (!isQuotaError(error) || window.localStorage.getItem(keys.legacyKey) === null) {
            throw error;
        }
    }
    window.localStorage.setItem(keys.legacyKey, stringify(value));
    return { kind: 'legacy' };
}

/** After an indexed commit: the legacy value, then every part key the committed index does not name. */
function removeSupersededKeys<TPart>(plan: CommitPlan<TPart>, keys: StorageKeys): void {
    window.localStorage.removeItem(keys.legacyKey);
    removeItems(
        readKeysWithPrefix(keys.partKeyPrefix).filter((key) => !plan.parts.has(key.slice(keys.partKeyPrefix.length)))
    );
}

/** Commits `value` by its plan and returns the parts now committed under the index, none when it went whole under the legacy key. */
function commitValue<TPart extends object>(
    value: unknown,
    plan: CommitPlan<TPart>,
    committed: CommittedParts<TPart>,
    keys: StorageKeys
): Map<string, CommittedPart<TPart>> {
    const result = commitPlan(value, plan, committed, keys);
    if (result.kind === 'legacy') {
        return new Map();
    }
    removeSupersededKeys(plan, keys);
    return result.parts;
}

/**
 * Forgets the committed parts another writer's `storage` event says may have changed: the one part
 * whose key it names, or every part when it names the index or a clear of all storage.
 */
function forgetChangedParts<TPart>(
    event: StorageEvent,
    keys: StorageKeys,
    committed: Map<string, CommittedPart<TPart>>
): void {
    if (event.storageArea !== window.localStorage) {
        return;
    }
    if (event.key === null || event.key === keys.indexKey) {
        committed.clear();
        return;
    }
    if (event.key.startsWith(keys.partKeyPrefix)) {
        committed.delete(event.key.slice(keys.partKeyPrefix.length));
    }
}

/** Forgets what another writer changes, as each `storage` event reports it, in the parts `readCommitted` returns then. */
function listenForOtherWriters<TPart>(keys: StorageKeys, readCommitted: () => Map<string, CommittedPart<TPart>>): void {
    if (typeof window === 'undefined') {
        return;
    }
    window.addEventListener('storage', (event) => {
        forgetChangedParts(event, keys, readCommitted());
    });
}

/**
 * A `localStorage` adapter that stores one value as an index key plus one key per part, so writing
 * a value that changed one part costs that part, not the whole value.
 *
 * A write first removes the parts the stored index names but the new value drops, so it needs no
 * room for runs it evicts, then replaces the changed parts' keys and then the index, the commit
 * point. If any of those writes is refused, every key the write had already changed is put back as
 * it was, so storage again holds exactly the previously committed value and a reload restores it.
 * Only after the index is written are the legacy value and every part key the index no longer
 * names removed, so a part left by a write that stopped never outlives the next commit. A part's
 * key is rewritten in place, as `createLocalStorage` rewrites its one key, so a write needs no more
 * room than the value it stores. When the parts do not fit beside the legacy value, the whole value
 * replaces the legacy one instead and migration waits for a later write.
 *
 * A read leaves out a part its index names that is missing or does not parse, and the next write
 * drops it from the index. A read whose index changed while its parts were read was taken while
 * another writer committed: it reads as empty and this adapter refuses every write until `clear`
 * or a reload, so a value built from it never replaces or removes the stored parts. `clear`
 * removes the index first, so a clear that stops partway reads as empty.
 *
 * A part is taken as unchanged, without reading its key, when it is the very object this adapter
 * last committed for its id, so callers must replace a part rather than mutate it. Another
 * writer's change reaches this adapter as a `storage` event, which forgets the part it names, or
 * every part for the index or a clear. Any other part is serialized and compared with its stored text.
 */
export const createPartitionedLocalStorage = <TData, TIndex, TPart extends object>(
    options: CreatePartitionedLocalStorageOptions<TData, TIndex, TPart>
): LocalStorageAdapter<TData> => {
    const { indexKey, partition } = options;
    const keys = readStorageKeys(options);
    let cachedValue: TData | null | undefined = undefined;
    let committed = new Map<string, CommittedPart<TPart>>();
    /** Why this adapter refuses every write, while it holds a value it must not write back. */
    let writeRefusal: string | null = null;

    function readStoredValue(): TData | null {
        const read = readLegacyOrIndexedValue(keys, partition);
        if (!read.consistent) {
            writeRefusal = 'was read while another writer was changing it';
            reportReadWhileChanging(indexKey);
            return null;
        }
        if (read.droppedIds.length > 0) {
            reportDroppedParts(indexKey, read.droppedIds);
        }
        committed = read.parts;
        return read.value;
    }

    function removeEverything(): void {
        // The index goes first: a clear that stops partway then reads as empty, never as a part list.
        removeItems([indexKey, keys.legacyKey, ...readKeysWithPrefix(keys.partKeyPrefix)]);
        committed = new Map();
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
        committed = commitValue(value, planCommit(value, partition), committed, keys);
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

    listenForOtherWriters(keys, () => committed);

    if (options.preserveSanitizedSourceWhen) {
        adapter.setProjected = (value): void => {
            cachedValue = value;
            writeRefusal = 'contains a quarantined unsupported schema';
        };
        adapter.shouldProjectSanitizedSource = options.preserveSanitizedSourceWhen;
    }

    return adapter;
};
