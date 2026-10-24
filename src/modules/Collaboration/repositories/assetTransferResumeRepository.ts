import {
    ASSET_RESUME_CHUNKS,
    ASSET_RESUME_MAX_AGE_MS,
    ASSET_RESUME_METADATA,
    type ResumeAuthority,
    type ResumeChunk,
    type ResumeJournal,
    type ResumeJournalEntry,
    type ResumeManifest,
    type ResumeMetadata,
} from '../models/AssetTransferResume';
import {
    MAX_ASSET_CHUNK_SIZE,
    MAX_ASSET_MIME_LEN,
    MAX_ASSET_NAME_LEN,
    MAX_ASSET_SIZE,
    MIN_ASSET_CHUNK_SIZE,
} from '../models/CollaborationTypes';

import { openAssetTransferResumeDatabase } from './assetTransferResumeIndexedDb';

type LegacyResumeMetadata = Omit<ResumeMetadata, 'schemaVersion'> & { schemaVersion: 1; received: number[] };
type StoredResumeMetadata = ResumeMetadata | LegacyResumeMetadata;

function requestValue<Value>(request: IDBRequest<Value>): Promise<Value> {
    return new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error ?? new Error('Asset resume storage request failed'));
    });
}

function assertAuthority(authority?: ResumeAuthority): void {
    if (authority && (authority.signal.aborted || !authority.isCurrent())) {
        throw new Error('Asset resume operation was superseded');
    }
}

async function transact<Result>(
    mode: IDBTransactionMode,
    body: (transaction: IDBTransaction) => Promise<Result>,
    authority?: ResumeAuthority
): Promise<Result> {
    assertAuthority(authority);
    const database = await openAssetTransferResumeDatabase();
    try {
        assertAuthority(authority);
    } catch (error) {
        database.close();
        throw error;
    }
    return new Promise((resolve, reject) => {
        let transaction: IDBTransaction;
        try {
            transaction = database.transaction([ASSET_RESUME_METADATA, ASSET_RESUME_CHUNKS], mode);
        } catch (error) {
            database.close();
            reject(error);
            return;
        }
        let result: Result;
        let failure: unknown;
        const abort = () => {
            try {
                transaction.abort();
            } catch {
                // A completed transaction already has an immutable result.
            }
        };
        const finish = () => {
            authority?.signal.removeEventListener('abort', abort);
            database.close();
        };
        authority?.signal.addEventListener('abort', abort, { once: true });
        transaction.oncomplete = () => {
            finish();
            resolve(result);
        };
        transaction.onabort = () => {
            finish();
            reject(failure ?? transaction.error ?? new Error('Asset resume transaction was aborted'));
        };
        transaction.onerror = () => {
            failure ??= transaction.error;
        };
        void body(transaction).then(
            (value) => {
                try {
                    assertAuthority(authority);
                    result = value;
                } catch (error) {
                    failure = error;
                    abort();
                }
            },
            (error: unknown) => {
                failure = error;
                abort();
            }
        );
    });
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isResumeManifest(value: unknown, hash: string): value is ResumeManifest {
    if (!isRecord(value)) {
        return false;
    }
    const chunkCount = value.chunkCount;
    return (
        value.hash === hash &&
        typeof value.size === 'number' &&
        Number.isInteger(value.size) &&
        value.size > 0 &&
        value.size <= MAX_ASSET_SIZE &&
        typeof value.chunkSize === 'number' &&
        Number.isInteger(value.chunkSize) &&
        value.chunkSize >= MIN_ASSET_CHUNK_SIZE &&
        value.chunkSize <= MAX_ASSET_CHUNK_SIZE &&
        typeof chunkCount === 'number' &&
        chunkCount === Math.ceil(value.size / value.chunkSize) &&
        typeof value.name === 'string' &&
        value.name.length <= MAX_ASSET_NAME_LEN &&
        typeof value.mime === 'string' &&
        value.mime.length <= MAX_ASSET_MIME_LEN
    );
}

function isMetadata(value: unknown): value is StoredResumeMetadata {
    if (!isRecord(value) || typeof value.hash !== 'string' || !isResumeManifest(value.manifest, value.hash)) {
        return false;
    }
    if (
        typeof value.ownerId !== 'string' ||
        typeof value.generation !== 'string' ||
        value.generation.length === 0 ||
        typeof value.writerId !== 'string' ||
        typeof value.revision !== 'number' ||
        !Number.isSafeInteger(value.revision) ||
        value.revision < 0 ||
        typeof value.lastVerifiedProgressAt !== 'number' ||
        !Number.isFinite(value.lastVerifiedProgressAt)
    ) {
        return false;
    }
    if (value.schemaVersion === 2) {
        const keys = [
            'schemaVersion',
            'ownerId',
            'hash',
            'generation',
            'writerId',
            'revision',
            'manifest',
            'lastVerifiedProgressAt',
        ];
        return (
            Object.keys(value).length === keys.length &&
            keys.every((key) => Object.hasOwn(value, key)) &&
            Object.keys(value.manifest).length === 6
        );
    }
    const chunkCount = value.manifest.chunkCount;
    return (
        value.schemaVersion === 1 &&
        Array.isArray(value.received) &&
        value.received.length <= chunkCount &&
        value.received.every(
            (index: unknown) => typeof index === 'number' && Number.isInteger(index) && index >= 0 && index < chunkCount
        )
    );
}

function chunkRange(metadata: Pick<ResumeMetadata, 'ownerId' | 'hash' | 'generation'>): IDBKeyRange {
    return IDBKeyRange.bound(
        [metadata.ownerId, metadata.hash, metadata.generation, 0],
        [metadata.ownerId, metadata.hash, metadata.generation, Number.MAX_SAFE_INTEGER]
    );
}

function sameRevision(actual: unknown, expected: StoredResumeMetadata): actual is StoredResumeMetadata {
    return (
        isMetadata(actual) &&
        actual.ownerId === expected.ownerId &&
        actual.hash === expected.hash &&
        actual.generation === expected.generation &&
        actual.writerId === expected.writerId &&
        actual.revision === expected.revision
    );
}

function nextRevision(metadata: StoredResumeMetadata): number {
    const revision = metadata.revision + 1;
    if (!Number.isSafeInteger(revision)) {
        throw new TypeError('Asset resume revision is exhausted');
    }
    return revision;
}

async function removeExact(expected: StoredResumeMetadata, authority?: ResumeAuthority): Promise<boolean> {
    return transact(
        'readwrite',
        async (transaction) => {
            const transfers = transaction.objectStore(ASSET_RESUME_METADATA);
            const actual: unknown = await requestValue(transfers.get([expected.ownerId, expected.hash]));
            if (!sameRevision(actual, expected)) {
                return false;
            }
            transfers.delete([expected.ownerId, expected.hash]);
            transaction.objectStore(ASSET_RESUME_CHUNKS).delete(chunkRange(expected));
            return true;
        },
        authority
    );
}

function chunkKeyIndex(key: IDBValidKey): number {
    if (!Array.isArray(key) || typeof key[3] !== 'number') {
        throw new TypeError('Asset resume chunk key is invalid');
    }
    return key[3];
}

// A v1 row is committed only when its index is listed. Migrate that authority
// once without loading the chunk payloads.
function preserveLegacyMembership(transaction: IDBTransaction, metadata: LegacyResumeMetadata): Promise<void> {
    const received = new Set(metadata.received);
    return new Promise((resolve, reject) => {
        const request = transaction.objectStore(ASSET_RESUME_CHUNKS).openKeyCursor(chunkRange(metadata));
        request.onerror = () => reject(request.error ?? new Error('Asset resume migration failed'));
        request.onsuccess = () => {
            const cursor = request.result;
            if (!cursor) {
                resolve();
                return;
            }
            if (!received.has(chunkKeyIndex(cursor.primaryKey))) {
                transaction.objectStore(ASSET_RESUME_CHUNKS).delete(cursor.primaryKey);
            }
            cursor.continue();
        };
    });
}

function isChunkData(value: unknown): value is Uint8Array {
    return ArrayBuffer.isView(value) && Object.prototype.toString.call(value) === '[object Uint8Array]';
}

function readChunkValue(value: unknown, index: number, metadata: ResumeMetadata): ResumeChunk | null {
    if (
        !Number.isInteger(index) ||
        index < 0 ||
        index >= metadata.manifest.chunkCount ||
        !isRecord(value) ||
        value.ownerId !== metadata.ownerId ||
        value.hash !== metadata.hash ||
        value.generation !== metadata.generation ||
        value.index !== index ||
        !isChunkData(value.data) ||
        typeof value.digest !== 'string' ||
        !/^sha256:[a-f0-9]{64}$/.test(value.digest)
    ) {
        return null;
    }
    return {
        ownerId: metadata.ownerId,
        hash: metadata.hash,
        generation: metadata.generation,
        index,
        data: value.data,
        digest: value.digest,
    };
}

async function* readJournalChunks(
    metadata: ResumeMetadata,
    authority?: ResumeAuthority
): AsyncIterable<ResumeJournalEntry> {
    let afterIndex: number | undefined;
    while (true) {
        const entry: ResumeJournalEntry | null = await transact(
            'readonly',
            async (transaction) => {
                const actual: unknown = await requestValue(
                    transaction.objectStore(ASSET_RESUME_METADATA).get([metadata.ownerId, metadata.hash])
                );
                if (!sameRevision(actual, metadata)) {
                    throw new Error('Asset resume reader was superseded');
                }
                const range = IDBKeyRange.bound(
                    [metadata.ownerId, metadata.hash, metadata.generation, afterIndex ?? 0],
                    [metadata.ownerId, metadata.hash, metadata.generation, Number.MAX_SAFE_INTEGER],
                    afterIndex !== undefined
                );
                // Leave this transaction before the caller hashes the single cloned row.
                const cursor = await requestValue(transaction.objectStore(ASSET_RESUME_CHUNKS).openCursor(range));
                if (!cursor) {
                    return null;
                }
                // Corrupt payload indices must never redirect the later exact cleanup.
                const index = chunkKeyIndex(cursor.primaryKey);
                return { index, chunk: readChunkValue(cursor.value, index, metadata) };
            },
            authority
        );
        assertAuthority(authority);
        if (!entry) {
            return;
        }
        afterIndex = entry.index;
        yield entry;
    }
}

async function claimResumeJournal(
    ownerId: string,
    hash: string,
    writerId: string,
    authority?: ResumeAuthority
): Promise<ResumeJournal | null> {
    const metadata = await transact(
        'readwrite',
        async (transaction) => {
            const transfers = transaction.objectStore(ASSET_RESUME_METADATA);
            const value: unknown = await requestValue(transfers.get([ownerId, hash]));
            if (value === undefined) {
                return null;
            }
            if (!isMetadata(value) || value.ownerId !== ownerId || value.hash !== hash) {
                throw new Error('Asset resume record is invalid');
            }
            if (Date.now() - value.lastVerifiedProgressAt > ASSET_RESUME_MAX_AGE_MS) {
                transfers.delete([ownerId, hash]);
                transaction.objectStore(ASSET_RESUME_CHUNKS).delete(chunkRange(value));
                return null;
            }
            if (value.schemaVersion === 1) {
                await preserveLegacyMembership(transaction, value);
            }
            const next: ResumeMetadata = {
                schemaVersion: 2,
                ownerId,
                hash,
                generation: value.generation,
                writerId,
                revision: nextRevision(value),
                manifest: {
                    hash: value.manifest.hash,
                    size: value.manifest.size,
                    chunkSize: value.manifest.chunkSize,
                    chunkCount: value.manifest.chunkCount,
                    name: value.manifest.name,
                    mime: value.manifest.mime,
                },
                lastVerifiedProgressAt: value.lastVerifiedProgressAt,
            };
            transfers.put(next);
            return next;
        },
        authority
    );
    return metadata ? { metadata, chunks: readJournalChunks(metadata, authority) } : null;
}

async function beginResumeJournal(
    ownerId: string,
    manifest: ResumeManifest,
    writerId: string,
    authority?: ResumeAuthority
): Promise<ResumeMetadata> {
    return transact(
        'readwrite',
        async (transaction) => {
            const transfers = transaction.objectStore(ASSET_RESUME_METADATA);
            const actual: unknown = await requestValue(transfers.get([ownerId, manifest.hash]));
            if (actual !== undefined) {
                throw new Error('Asset resume record changed before manifest admission');
            }
            const metadata: ResumeMetadata = {
                schemaVersion: 2,
                ownerId,
                hash: manifest.hash,
                generation: crypto.randomUUID(),
                writerId,
                revision: 0,
                manifest: {
                    hash: manifest.hash,
                    size: manifest.size,
                    chunkSize: manifest.chunkSize,
                    chunkCount: manifest.chunkCount,
                    name: manifest.name,
                    mime: manifest.mime,
                },
                lastVerifiedProgressAt: Date.now(),
            };
            if (!isMetadata(metadata)) {
                throw new Error('Asset resume manifest is invalid');
            }
            transfers.put(metadata);
            return metadata;
        },
        authority
    );
}

async function appendResumeChunk(
    ownerId: string,
    expected: ResumeMetadata,
    index: number,
    data: Uint8Array,
    digest: string,
    authority?: ResumeAuthority
): Promise<ResumeMetadata> {
    return transact(
        'readwrite',
        async (transaction) => {
            const transfers = transaction.objectStore(ASSET_RESUME_METADATA);
            const actual: unknown = await requestValue(transfers.get([ownerId, expected.hash]));
            if (!sameRevision(actual, expected) || actual.schemaVersion !== 2) {
                throw new Error('Asset resume writer was superseded');
            }
            const expectedSize = Math.min(
                actual.manifest.chunkSize,
                actual.manifest.size - index * actual.manifest.chunkSize
            );
            if (
                expected.ownerId !== ownerId ||
                !Number.isInteger(index) ||
                index < 0 ||
                index >= actual.manifest.chunkCount ||
                data.byteLength !== expectedSize ||
                !/^sha256:[a-f0-9]{64}$/.test(digest)
            ) {
                throw new Error('Asset resume chunk is invalid');
            }
            const chunks = transaction.objectStore(ASSET_RESUME_CHUNKS);
            const key = [ownerId, expected.hash, expected.generation, index];
            if ((await requestValue(chunks.getKey(key))) !== undefined) {
                return actual;
            }
            const next: ResumeMetadata = {
                ...actual,
                revision: nextRevision(actual),
                lastVerifiedProgressAt: Date.now(),
            };
            transaction.objectStore(ASSET_RESUME_CHUNKS).put({
                ownerId,
                hash: expected.hash,
                generation: expected.generation,
                index,
                data,
                digest,
            } satisfies ResumeChunk);
            transfers.put(next);
            return next;
        },
        authority
    );
}

async function discardResumeChunks(
    ownerId: string,
    expected: ResumeMetadata,
    indices: readonly number[],
    authority?: ResumeAuthority
): Promise<ResumeMetadata> {
    return transact(
        'readwrite',
        async (transaction) => {
            const transfers = transaction.objectStore(ASSET_RESUME_METADATA);
            const actual: unknown = await requestValue(transfers.get([ownerId, expected.hash]));
            if (expected.ownerId !== ownerId || !sameRevision(actual, expected) || actual.schemaVersion !== 2) {
                throw new Error('Asset resume writer was superseded');
            }
            const rejected = new Set(indices);
            const next: ResumeMetadata = {
                ...actual,
                revision: nextRevision(actual),
            };
            for (const index of rejected) {
                transaction
                    .objectStore(ASSET_RESUME_CHUNKS)
                    .delete([ownerId, expected.hash, expected.generation, index]);
            }
            transfers.put(next);
            return next;
        },
        authority
    );
}

async function removeResumeJournal(
    ownerId: string,
    expected: ResumeMetadata,
    authority?: ResumeAuthority
): Promise<boolean> {
    return expected.ownerId === ownerId && removeExact(expected, authority);
}

async function expireResumeJournals(now: number): Promise<number> {
    const values: unknown[] = await transact('readonly', (transaction) =>
        requestValue(transaction.objectStore(ASSET_RESUME_METADATA).getAll())
    );
    let removed = 0;
    for (const value of values) {
        if (
            isMetadata(value) &&
            now - value.lastVerifiedProgressAt > ASSET_RESUME_MAX_AGE_MS &&
            (await removeExact(value))
        ) {
            removed++;
        }
    }
    return removed;
}

/** One writer claim fences old renderers without granting any complete-asset ownership. */
export function createAssetTransferResumeRepository(ownerId: string) {
    return {
        claim(hash: string, writerId: string, authority?: ResumeAuthority): Promise<ResumeJournal | null> {
            return claimResumeJournal(ownerId, hash, writerId, authority);
        },
        begin(manifest: ResumeManifest, writerId: string, authority?: ResumeAuthority): Promise<ResumeMetadata> {
            return beginResumeJournal(ownerId, manifest, writerId, authority);
        },
        append(
            expected: ResumeMetadata,
            index: number,
            data: Uint8Array,
            digest: string,
            authority?: ResumeAuthority
        ): Promise<ResumeMetadata> {
            return appendResumeChunk(ownerId, expected, index, data, digest, authority);
        },
        discard(
            expected: ResumeMetadata,
            indices: readonly number[],
            authority?: ResumeAuthority
        ): Promise<ResumeMetadata> {
            return discardResumeChunks(ownerId, expected, indices, authority);
        },
        remove(expected: ResumeMetadata, authority?: ResumeAuthority): Promise<boolean> {
            return removeResumeJournal(ownerId, expected, authority);
        },
        expire(now = Date.now()): Promise<number> {
            return expireResumeJournals(now);
        },
    };
}
