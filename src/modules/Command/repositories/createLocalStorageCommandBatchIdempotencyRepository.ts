import {
    type CommandBatchIdempotencyClaim,
    type CommandBatchIdempotencyLookup,
    type CommandBatchIdempotencyRepository,
} from '../models/CommandBatchIdempotency';

const STORAGE_KEY = 'sourdaw:command-batch-idempotency:v1';
const MAX_RECORDS = 4_096;
const MAX_RECEIPT_BYTES = 1_048_576;
const LOCK_NAME = 'sourdaw:command-batch-idempotency';

type RequestExclusiveLock = <TResult>(task: () => TResult | Promise<TResult>) => Promise<TResult>;

type CreateLocalStorageCommandBatchIdempotencyRepositoryInput = {
    requestExclusiveLock?: RequestExclusiveLock;
};

type StoredRecord = {
    schemaVersion: 1;
    projectId: string;
    idempotencyKey: string;
    contentHash: string;
    state: 'pending' | 'complete';
    serializedReceipt?: string;
    updatedAt: number;
};

function isString(value: unknown, maxLength: number): value is string {
    return typeof value === 'string' && value.length > 0 && value.length <= maxLength;
}

function validateIdentity(input: { projectId: string; idempotencyKey: string; contentHash: string }): void {
    if (!isString(input.projectId, 512) || !isString(input.idempotencyKey, 1_024)) {
        throw new Error('The durable idempotency identity is invalid');
    }
    if (!/^sha256:[a-f0-9]{64}$/.test(input.contentHash)) {
        throw new Error('The durable idempotency content hash is invalid');
    }
}

function decodeRecords(raw: string | null): StoredRecord[] {
    if (!raw) {
        return [];
    }
    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch {
        throw new Error('The durable idempotency store is not valid JSON');
    }
    if (!Array.isArray(parsed) || parsed.length > MAX_RECORDS) {
        throw new Error('The durable idempotency store has an invalid record count');
    }
    const records: StoredRecord[] = [];
    const keys = new Set<string>();
    for (const value of parsed) {
        if (typeof value !== 'object' || value === null || Array.isArray(value)) {
            throw new Error('The durable idempotency store contains an invalid record');
        }
        const record = value as Record<string, unknown>;
        if (
            record.schemaVersion !== 1 ||
            !isString(record.projectId, 512) ||
            !isString(record.idempotencyKey, 1024) ||
            !isString(record.contentHash, 128) ||
            !/^sha256:[a-f0-9]{64}$/.test(record.contentHash) ||
            (record.state !== 'pending' && record.state !== 'complete') ||
            typeof record.updatedAt !== 'number' ||
            !Number.isSafeInteger(record.updatedAt) ||
            record.updatedAt < 0
        ) {
            throw new Error('The durable idempotency store contains an invalid record');
        }
        if (
            record.state === 'complete' &&
            (!isString(record.serializedReceipt, MAX_RECEIPT_BYTES) ||
                new TextEncoder().encode(record.serializedReceipt).byteLength > MAX_RECEIPT_BYTES)
        ) {
            throw new Error('The durable idempotency store contains an invalid receipt');
        }
        if (record.state === 'pending' && record.serializedReceipt !== undefined) {
            throw new Error('The durable idempotency store contains an invalid pending record');
        }
        const key = `${record.projectId}\u0000${record.idempotencyKey}`;
        if (keys.has(key)) {
            throw new Error('The durable idempotency store contains duplicate keys');
        }
        keys.add(key);
        const serializedReceipt = typeof record.serializedReceipt === 'string' ? record.serializedReceipt : undefined;
        records.push({
            schemaVersion: 1,
            projectId: record.projectId,
            idempotencyKey: record.idempotencyKey,
            contentHash: record.contentHash,
            state: record.state,
            ...(serializedReceipt ? { serializedReceipt } : {}),
            updatedAt: record.updatedAt,
        });
    }
    return records;
}

function persistRecords(records: readonly StoredRecord[]): void {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
}

function findRecord(
    records: readonly StoredRecord[],
    input: { projectId: string; idempotencyKey: string }
): StoredRecord | undefined {
    return records.find(
        (record) => record.projectId === input.projectId && record.idempotencyKey === input.idempotencyKey
    );
}

async function requestBrowserExclusiveLock<TResult>(task: () => TResult | Promise<TResult>): Promise<TResult> {
    return navigator.locks.request(LOCK_NAME, { mode: 'exclusive' }, task);
}

// This safety ledger intentionally uses fresh reads inside a cross-client Web
// Lock. A Store-backed cache could hide another client's claim and permit the
// same external effect twice; malformed durable data must also fail closed.
export function createLocalStorageCommandBatchIdempotencyRepository(
    input: CreateLocalStorageCommandBatchIdempotencyRepositoryInput = {}
): CommandBatchIdempotencyRepository {
    const requestExclusiveLock = input.requestExclusiveLock ?? requestBrowserExclusiveLock;
    return {
        lookup(input): Promise<CommandBatchIdempotencyLookup> {
            return requestExclusiveLock(() => {
                validateIdentity(input);
                const existing = findRecord(decodeRecords(localStorage.getItem(STORAGE_KEY)), input);
                if (!existing) {
                    return { status: 'missing' };
                }
                if (existing.contentHash !== input.contentHash) {
                    return { status: 'conflict' };
                }
                if (existing.state === 'complete' && existing.serializedReceipt) {
                    return { status: 'complete', serializedReceipt: existing.serializedReceipt };
                }
                return { status: 'pending' };
            });
        },
        claim(input): Promise<CommandBatchIdempotencyClaim> {
            return requestExclusiveLock(() => {
                validateIdentity(input);
                const records = decodeRecords(localStorage.getItem(STORAGE_KEY));
                const existing = findRecord(records, input);
                if (existing) {
                    if (existing.contentHash !== input.contentHash) {
                        return { status: 'conflict' };
                    }
                    if (existing.state === 'complete' && existing.serializedReceipt) {
                        return { status: 'complete', serializedReceipt: existing.serializedReceipt };
                    }
                    return { status: 'pending' };
                }
                if (records.length >= MAX_RECORDS) {
                    throw new Error('The durable idempotency store reached its retention limit');
                }
                const claimed: StoredRecord[] = [
                    ...records,
                    {
                        schemaVersion: 1,
                        projectId: input.projectId,
                        idempotencyKey: input.idempotencyKey,
                        contentHash: input.contentHash,
                        state: 'pending',
                        updatedAt: Date.now(),
                    },
                ];
                persistRecords(claimed);
                return { status: 'claimed' };
            });
        },
        complete(input): Promise<void> {
            return requestExclusiveLock(() => {
                validateIdentity(input);
                const records = decodeRecords(localStorage.getItem(STORAGE_KEY));
                const existing = findRecord(records, input);
                if (!existing || existing.contentHash !== input.contentHash) {
                    throw new Error('The durable idempotency claim no longer matches the completed batch');
                }
                if (new TextEncoder().encode(input.serializedReceipt).byteLength > MAX_RECEIPT_BYTES) {
                    throw new Error('The verified batch receipt exceeds the durable idempotency limit');
                }
                const completed: StoredRecord = {
                    ...existing,
                    state: 'complete',
                    serializedReceipt: input.serializedReceipt,
                    updatedAt: Date.now(),
                };
                persistRecords(records.map((record) => (record === existing ? completed : record)));
            });
        },
    };
}
