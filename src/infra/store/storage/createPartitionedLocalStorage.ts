import { parse, stringify } from 'superjson';

import { logger } from '#/infra/logger/appLogger';
import { type LocalStorageKey, type LocalStoragePartKeyPrefix } from '#/infra/store/storage/LocalStorageKeys';

import { type LocalStorageAdapter } from './createLocalStorage';
import {
    decodeIndexText,
    decodePartText,
    encodeIndexText,
    encodePartText,
    IN_FLIGHT_COMMIT_BOUND_MS,
    type IndexEntry,
} from './partitionedStorageFormat';
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

/** A part as this adapter last read or committed it: the object, its key's text then, and the commit that wrote it. */
type CommittedPart<TPart> = { part: TPart; text: string; commit: string };

type CommittedParts<TPart> = ReadonlyMap<string, CommittedPart<TPart>>;

/**
 * What one read found. A read is consistent when every key it depends on held the same text when
 * read again afterwards, the index parses, and no part it names was written by a commit the index
 * does not name that may still be running. A part it names that is missing, does not parse, or was
 * left by a commit that stopped before its index write is left out and listed in `droppedIds`.
 */
type StoredRead<TData, TPart> =
    | { consistent: true; value: TData | null; parts: Map<string, CommittedPart<TPart>>; droppedIds: string[] }
    | { consistent: false };

type StorageKeys = {
    legacyKey: string;
    indexKey: string;
    partKeyPrefix: string;
    partKey: (id: string) => string;
};

/** A key a write changed and the text it held before, so a refused write can put it back. */
type ReplacedItem = { key: string; previousText: string | null };

/** The text each key a read depends on held: the legacy key, the index, and every part the index names. */
type StoredTexts = ReadonlyMap<string, string | null>;

function readStorageKeys(options: { legacyKey: string; indexKey: string; partKeyPrefix: string }): StorageKeys {
    const { legacyKey, indexKey, partKeyPrefix } = options;
    return { legacyKey, indexKey, partKeyPrefix, partKey: (id) => `${partKeyPrefix}${id}` };
}

function readStoredTexts(keys: StorageKeys): StoredTexts {
    const legacyText = window.localStorage.getItem(keys.legacyKey);
    const indexText = window.localStorage.getItem(keys.indexKey);
    const texts = new Map([
        [keys.legacyKey, legacyText],
        [keys.indexKey, indexText],
    ]);
    if (legacyText !== null || indexText === null) {
        return texts;
    }
    for (const { id } of decodeIndexText(indexText)?.parts ?? []) {
        texts.set(keys.partKey(id), window.localStorage.getItem(keys.partKey(id)));
    }
    return texts;
}

/** Whether every key still holds the text it was read with: since no key holds the same text twice, it held it throughout. */
function storageStillHolds(texts: StoredTexts): boolean {
    for (const [key, text] of texts) {
        if (window.localStorage.getItem(key) !== text) {
            return false;
        }
    }
    return true;
}

/** The part a key's text holds for an index entry: null when it must be dropped, `in flight` when another commit may be writing it. */
function readNamedPart<TPart>(
    entry: IndexEntry,
    text: string | null,
    now: number
): CommittedPart<TPart> | 'in flight' | null {
    const stored = text === null ? null : decodePartText(text);
    if (text === null || stored === null) {
        return null;
    }
    if (stored.header.commit !== entry.commit) {
        return now - stored.header.writtenAt < IN_FLIGHT_COMMIT_BOUND_MS ? 'in flight' : null;
    }
    try {
        return { part: parse<TPart>(stored.body), text, commit: entry.commit };
    } catch {
        return null;
    }
}

function readIndexedValue<TData, TIndex, TPart extends object>(
    keys: StorageKeys,
    texts: StoredTexts,
    partition: LocalStoragePartition<TData, TIndex, TPart>
): StoredRead<TData, TPart> {
    const indexText = texts.get(keys.indexKey) ?? null;
    if (indexText === null) {
        return { consistent: true, value: null, parts: new Map(), droppedIds: [] };
    }
    const stored = decodeIndexText<TIndex>(indexText);
    if (stored === null) {
        return { consistent: false };
    }
    const now = Date.now();
    const parts = new Map<string, CommittedPart<TPart>>();
    const droppedIds: string[] = [];
    for (const entry of stored.parts) {
        const part = readNamedPart<TPart>(entry, texts.get(keys.partKey(entry.id)) ?? null, now);
        if (part === 'in flight') {
            return { consistent: false };
        }
        if (part === null) {
            droppedIds.push(entry.id);
            continue;
        }
        parts.set(entry.id, part);
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
    const texts = readStoredTexts(keys);
    if (!storageStillHolds(texts)) {
        return { consistent: false };
    }
    const legacyText = texts.get(keys.legacyKey) ?? null;
    if (legacyText === null) {
        return readIndexedValue(keys, texts, partition);
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
        `[localStorage] "${key}" names ${String(droppedIds.length)} part(s) that are missing, do not parse, ` +
            'or were left by a write that stopped before its index; ' +
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

/** A key a commit writes, in order before its index, and the text it writes there. */
type KeyWrite = { key: string; text: string };

/** What a commit writes before its index, the index text, and the parts it commits. */
type CommitPlan<TPart> = { writes: KeyWrite[]; indexText: string; parts: Map<string, CommittedPart<TPart>> };

/** A part a commit keeps as its key holds it, or the part's superjson text it writes. */
type PartChoice<TPart> =
    { kind: 'kept'; committed: CommittedPart<TPart> } | { kind: 'written'; part: TPart; body: string };

/** The stored index's text and the commit it names for each part. */
type StoredCommits = { text: string | null; commits: ReadonlyMap<string, string> };

/**
 * Keeps a part when its key still holds the text this adapter committed for that very object, or
 * holds the same part text under any commit; otherwise serializes it to be written. The key is read
 * either way, since another writer may have changed it before its `storage` event arrives.
 */
function choosePart<TPart>(
    id: string,
    part: TPart,
    committed: CommittedParts<TPart>,
    keys: StorageKeys
): PartChoice<TPart> {
    const storedText = window.localStorage.getItem(keys.partKey(id));
    const entry = committed.get(id);
    if (entry?.part === part && entry.text === storedText) {
        return { kind: 'kept', committed: entry };
    }
    const body = stringify(part);
    const stored = storedText === null ? null : decodePartText(storedText);
    if (storedText !== null && stored?.body === body) {
        return { kind: 'kept', committed: { part, text: storedText, commit: stored.header.commit } };
    }
    return { kind: 'written', part, body };
}

function readStoredCommits(keys: StorageKeys): StoredCommits {
    const text = window.localStorage.getItem(keys.indexKey);
    const entries = text === null ? [] : (decodeIndexText(text)?.parts ?? []);
    return { text, commits: new Map(entries.map(({ id, commit }) => [id, commit])) };
}

/**
 * The commit that writes a plan's parts. A commit that changes one part key and nothing else is a
 * single write, so it keeps the commit the stored index names for that part and leaves the index as
 * it is. Every other commit takes a fresh one, so a read between its writes finds a part written by
 * a commit its index does not name.
 */
let nextWriteSequence = 0;

/**
 * A token no other write of this page or another tab shares. It draws its randomness from
 * `getRandomValues` and counts writes of its own, never from `crypto.randomUUID`, so a caller that
 * stubs `randomUUID` to a fixed or repeating sequence neither repeats a token nor has its sequence
 * consumed by storage writes it never asked for.
 */
function newWriteToken(): string {
    nextWriteSequence += 1;
    const random = crypto.getRandomValues(new Uint32Array(4));
    return `${nextWriteSequence.toString(36)}-${Array.from(random, (word) => word.toString(16)).join('')}`;
}

function chooseCommit(shape: {
    writtenIds: readonly string[];
    changesOtherKeys: boolean;
    stored: StoredCommits;
    indexTextFor: (commit: string) => string;
}): string {
    const { writtenIds, changesOtherKeys, stored, indexTextFor } = shape;
    const [onlyId] = writtenIds;
    if (onlyId !== undefined && writtenIds.length === 1 && !changesOtherKeys) {
        const reused = stored.commits.get(onlyId);
        if (reused !== undefined && indexTextFor(reused) === stored.text) {
            return reused;
        }
    }
    return newWriteToken();
}

function writtenPartText(commit: string, body: string): string {
    return encodePartText({ commit, write: newWriteToken(), writtenAt: Date.now() }, body);
}

/**
 * Plans a commit of `value`: first an empty part, written by this commit, over each stored part the
 * value drops, so the commit needs no room for parts it evicts and a read before its index write
 * finds them written by a commit its index does not name; then every part not kept; then the index.
 */
function planCommit<TData, TIndex, TPart extends object>(
    value: TData,
    partition: LocalStoragePartition<TData, TIndex, TPart>,
    committed: CommittedParts<TPart>,
    keys: StorageKeys
): CommitPlan<TPart> {
    const { index, parts } = partition.split(value);
    const byId = new Map(parts.map((part) => [partition.identify(part), part]));
    const choices = new Map(Array.from(byId, ([id, part]) => [id, choosePart(id, part, committed, keys)]));
    const stored = readStoredCommits(keys);
    const evictedIds = Array.from(stored.commits.keys()).filter((id) => !choices.has(id));
    const indexTextFor = (commit: string) =>
        encodeIndexText(
            index,
            Array.from(choices, ([id, choice]) => ({
                id,
                commit: choice.kind === 'kept' ? choice.committed.commit : commit,
            }))
        );
    const commit = chooseCommit({
        writtenIds: Array.from(choices.keys()).filter((id) => choices.get(id)?.kind === 'written'),
        changesOtherKeys: evictedIds.length > 0 || window.localStorage.getItem(keys.legacyKey) !== null,
        stored,
        indexTextFor,
    });
    const writes = evictedIds
        .filter((id) => window.localStorage.getItem(keys.partKey(id)) !== null)
        .map((id) => ({ key: keys.partKey(id), text: writtenPartText(commit, '') }));
    const committedParts = new Map<string, CommittedPart<TPart>>();
    for (const [id, choice] of choices) {
        if (choice.kind === 'kept') {
            committedParts.set(id, choice.committed);
            continue;
        }
        const text = writtenPartText(commit, choice.body);
        writes.push({ key: keys.partKey(id), text });
        committedParts.set(id, { part: choice.part, text, commit });
    }
    return { writes, indexText: indexTextFor(commit), parts: committedParts };
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

function writePlanThenIndex<TPart>(plan: CommitPlan<TPart>, keys: StorageKeys, replaced: ReplacedItem[]): void {
    for (const { key, text } of plan.writes) {
        replaceItem(key, text, replaced);
    }
    replaceItem(keys.indexKey, plan.indexText, replaced);
}

/** Where a commit left the value: under the index, or whole under the legacy key. */
type CommitResult = 'indexed' | 'legacy';

/**
 * Commits a plan through the index, keeping the legacy value until the index is written, so a stop
 * anywhere before that still reads the legacy value. When storage has no room for the parts beside
 * the legacy value, every key the attempt changed is put back and the whole value replaces the
 * legacy one in a single write, so a stop reads either value whole; migration waits for a later
 * write. When that write is refused too, the legacy value stays byte for byte and the error is thrown.
 */
function commitPlan<TPart>(value: unknown, plan: CommitPlan<TPart>, keys: StorageKeys): CommitResult {
    const replaced: ReplacedItem[] = [];
    try {
        writePlanThenIndex(plan, keys, replaced);
        return 'indexed';
    } catch (error) {
        restoreReplacedItems(replaced);
        if (!isQuotaError(error) || window.localStorage.getItem(keys.legacyKey) === null) {
            throw error;
        }
    }
    window.localStorage.setItem(keys.legacyKey, stringify(value));
    return 'legacy';
}

/** After an indexed commit: the legacy value, then every part key the committed index does not name. */
function removeSupersededKeys<TPart>(plan: CommitPlan<TPart>, keys: StorageKeys): void {
    window.localStorage.removeItem(keys.legacyKey);
    removeItems(
        readKeysWithPrefix(keys.partKeyPrefix).filter((key) => !plan.parts.has(key.slice(keys.partKeyPrefix.length)))
    );
}

/** Commits `value` by its plan and returns the parts now committed under the index, none when it went whole under the legacy key. */
function commitValue<TPart>(
    value: unknown,
    plan: CommitPlan<TPart>,
    keys: StorageKeys
): Map<string, CommittedPart<TPart>> {
    if (commitPlan(value, plan, keys) === 'legacy') {
        return new Map();
    }
    removeSupersededKeys(plan, keys);
    return plan.parts;
}

/**
 * A `localStorage` adapter that stores one value as an index key plus one key per part, so writing
 * a value that changed one part costs that part, not the whole value.
 *
 * Each part key holds a header naming the commit that wrote it, and the index names, beside each
 * part, the commit that must have written its key. A write that changes more than one key takes a
 * fresh commit: it first overwrites each part the stored index names but the new value drops with an
 * empty part of that commit, so it needs no room for runs it evicts, then writes the changed parts
 * and then the index, the commit point. A write that changes one part key and nothing else keeps the
 * commit the index names for it and leaves the index alone. If any write is refused, every key the
 * write had already changed is put back as it was, so storage again holds exactly the previously
 * committed value and a reload restores it. Only after the index is written are the legacy value
 * and every part key the index no longer names removed. A part's key is rewritten in place, as
 * `createLocalStorage` rewrites its one key, so a write needs no more room than the value it stores.
 * When the parts do not fit beside the legacy value, the whole value replaces the legacy one instead
 * and migration waits for a later write.
 *
 * A read takes every key it depends on, then reads them all again; it is consistent only when each
 * still holds the text it was read with, and since a header makes every write's text unique, those
 * texts were all stored together at one moment. A part written by a commit its index does not name
 * belongs to a commit that has not written its index yet. Within `IN_FLIGHT_COMMIT_BOUND_MS` of that
 * write the commit may still be running, so the read is not consistent: it reads as empty and this
 * adapter refuses every write until `clear` or a reload, so a value built from it never replaces or
 * removes the stored parts. Later, the commit stopped before its index write, and the part is left
 * out like a part that is missing or does not parse, which no commit leaves behind: a warning names
 * them and the next write drops them from the index. `clear` removes the index first, so a clear
 * that stops partway reads as empty.
 *
 * A part is kept without serializing it when it is the very object this adapter last committed for
 * its id and its key still holds the text committed then, so callers must replace a part rather than
 * mutate it. Any other part is serialized and kept only when its key already holds that text.
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
        committed = commitValue(value, planCommit(value, partition, committed, keys), keys);
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
