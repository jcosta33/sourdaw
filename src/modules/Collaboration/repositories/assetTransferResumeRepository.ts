import {
    ASSET_RESUME_CHUNKS,
    ASSET_RESUME_MAX_AGE_MS,
    ASSET_RESUME_METADATA,
    type ResumeAuthority,
    type ResumeChunk,
    type ResumeJournal,
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

function isMetadata(value: unknown): value is ResumeMetadata {
    if (!isRecord(value) || typeof value.hash !== 'string' || !isResumeManifest(value.manifest, value.hash)) {
        return false;
    }
    const chunkCount = value.manifest.chunkCount;
    return (
        value.schemaVersion === 1 &&
        typeof value.ownerId === 'string' &&
        typeof value.generation === 'string' &&
        value.generation.length > 0 &&
        typeof value.writerId === 'string' &&
        typeof value.revision === 'number' &&
        Number.isSafeInteger(value.revision) &&
        value.revision >= 0 &&
        typeof value.lastVerifiedProgressAt === 'number' &&
        Number.isFinite(value.lastVerifiedProgressAt) &&
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

function sameRevision(actual: unknown, expected: ResumeMetadata): actual is ResumeMetadata {
    return (
        isMetadata(actual) &&
        actual.generation === expected.generation &&
        actual.writerId === expected.writerId &&
        actual.revision === expected.revision
    );
}

function nextRevision(metadata: ResumeMetadata): number {
    const revision = metadata.revision + 1;
    if (!Number.isSafeInteger(revision)) {
        throw new TypeError('Asset resume revision is exhausted');
    }
    return revision;
}

async function removeExact(expected: ResumeMetadata, authority?: ResumeAuthority): Promise<boolean> {
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

async function claimResumeJournal(
    ownerId: string,
    hash: string,
    writerId: string,
    authority?: ResumeAuthority
): Promise<ResumeJournal | null> {
    return transact(
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
            const values: unknown[] = await requestValue(
                transaction.objectStore(ASSET_RESUME_CHUNKS).getAll(chunkRange(value))
            );
            const metadata: ResumeMetadata = { ...value, writerId, revision: nextRevision(value) };
            transfers.put(metadata);
            const chunks: ResumeChunk[] = [];
            for (const chunk of values) {
                if (
                    !isRecord(chunk) ||
                    typeof chunk.index !== 'number' ||
                    !value.received.includes(chunk.index) ||
                    !ArrayBuffer.isView(chunk.data) ||
                    Object.prototype.toString.call(chunk.data) !== '[object Uint8Array]' ||
                    typeof chunk.digest !== 'string' ||
                    chunk.ownerId !== ownerId ||
                    chunk.hash !== hash ||
                    chunk.generation !== value.generation
                ) {
                    continue;
                }
                const data = new Uint8Array(chunk.data.byteLength);
                data.set(new Uint8Array(chunk.data.buffer, chunk.data.byteOffset, chunk.data.byteLength));
                chunks.push({
                    ownerId,
                    hash,
                    generation: value.generation,
                    index: chunk.index,
                    data,
                    digest: chunk.digest,
                });
            }
            return { metadata, chunks };
        },
        authority
    );
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
                schemaVersion: 1,
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
                received: [],
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
            if (!sameRevision(actual, expected)) {
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
            if (actual.received.includes(index)) {
                return actual;
            }
            const next: ResumeMetadata = {
                ...actual,
                revision: nextRevision(actual),
                received: [...actual.received, index],
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
            if (expected.ownerId !== ownerId || !sameRevision(actual, expected)) {
                throw new Error('Asset resume writer was superseded');
            }
            const rejected = new Set(indices);
            const next: ResumeMetadata = {
                ...actual,
                revision: nextRevision(actual),
                received: actual.received.filter((index) => !rejected.has(index)),
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
