import {
    type CommandBatchIdempotencyClaim,
    type CommandBatchIdempotencyLookup,
    type CommandBatchIdempotencyRepository,
} from '../models/CommandBatchIdempotency';

const STORAGE_KEY = 'sourdaw:command-batch-idempotency:v1';
const MAX_RECORDS = 4_096;
const MAX_RECEIPT_BYTES = 1_048_576;
const LOCK_NAME = 'sourdaw:command-batch-idempotency';
const CLAIM_LOCK_PREFIX = `${LOCK_NAME}:claim:`;

type RequestExclusiveLock = <TResult>(task: () => TResult | Promise<TResult>) => Promise<TResult>;
type ClaimLease = { release: () => void };
type TryAcquireClaimLease = (name: string) => Promise<ClaimLease | null>;

type CreateLocalStorageCommandBatchIdempotencyRepositoryInput = {
    requestExclusiveLock?: RequestExclusiveLock;
    tryAcquireClaimLease?: TryAcquireClaimLease;
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

function recordKey(input: { projectId: string; idempotencyKey: string }): string {
    return `${input.projectId}\u0000${input.idempotencyKey}`;
}

function claimLockName(input: { projectId: string; idempotencyKey: string }): string {
    return `${CLAIM_LOCK_PREFIX}${JSON.stringify([input.projectId, input.idempotencyKey])}`;
}

async function requestBrowserExclusiveLock<TResult>(task: () => TResult | Promise<TResult>): Promise<TResult> {
    return navigator.locks.request(LOCK_NAME, { mode: 'exclusive' }, task);
}

function tryAcquireBrowserClaimLease(name: string): Promise<ClaimLease | null> {
    return new Promise<ClaimLease | null>((resolve, reject) => {
        let release!: () => void;
        const hold = new Promise<void>((resolve) => {
            release = resolve;
        });
        let acquisitionSettled = false;
        const request = navigator.locks.request(name, { mode: 'exclusive', ifAvailable: true }, async (lock) => {
            acquisitionSettled = true;
            if (lock === null) {
                resolve(null);
                return;
            }
            resolve({ release });
            await hold;
        });
        void request.catch((error: unknown) => {
            if (!acquisitionSettled) {
                reject(error instanceof Error ? error : new Error(String(error)));
            }
        });
    });
}

// This safety ledger intentionally uses fresh reads inside a cross-client Web
// Lock. A Store-backed cache could hide another client's claim and permit the
// same external effect twice; malformed durable data must also fail closed.
export function createLocalStorageCommandBatchIdempotencyRepository(
    input: CreateLocalStorageCommandBatchIdempotencyRepositoryInput = {}
): CommandBatchIdempotencyRepository {
    const requestExclusiveLock = input.requestExclusiveLock ?? requestBrowserExclusiveLock;
    const tryAcquireClaimLease = input.tryAcquireClaimLease ?? tryAcquireBrowserClaimLease;
    const claimLeases = new Map<string, ClaimLease>();

    function releaseClaimLease(input: { projectId: string; idempotencyKey: string }): void {
        const key = recordKey(input);
        const lease = claimLeases.get(key);
        if (!lease) {
            return;
        }
        claimLeases.delete(key);
        lease.release();
    }

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
        async claim(input): Promise<CommandBatchIdempotencyClaim> {
            const key = recordKey(input);
            if (claimLeases.has(key)) {
                return requestExclusiveLock(() => {
                    validateIdentity(input);
                    const existing = findRecord(decodeRecords(localStorage.getItem(STORAGE_KEY)), input);
                    if (!existing) {
                        throw new Error('The live idempotency claim has no durable record');
                    }
                    if (existing.contentHash !== input.contentHash) {
                        return { status: 'conflict' };
                    }
                    if (existing.state === 'complete' && existing.serializedReceipt) {
                        return { status: 'complete', serializedReceipt: existing.serializedReceipt };
                    }
                    return { status: 'pending' };
                });
            }
            const lease = await tryAcquireClaimLease(claimLockName(input));
            if (!lease) {
                return requestExclusiveLock(() => {
                    validateIdentity(input);
                    const existing = findRecord(decodeRecords(localStorage.getItem(STORAGE_KEY)), input);
                    if (!existing) {
                        return { status: 'pending' };
                    }
                    if (existing.contentHash !== input.contentHash) {
                        return { status: 'conflict' };
                    }
                    if (existing.state === 'complete' && existing.serializedReceipt) {
                        return { status: 'complete', serializedReceipt: existing.serializedReceipt };
                    }
                    return { status: 'pending' };
                });
            }
            let retainLease = false;
            try {
                const result = await requestExclusiveLock(() => {
                    validateIdentity(input);
                    const records = decodeRecords(localStorage.getItem(STORAGE_KEY));
                    const existing = findRecord(records, input);
                    if (existing) {
                        if (existing.contentHash !== input.contentHash) {
                            return { status: 'conflict' } as const;
                        }
                        if (existing.state === 'complete' && existing.serializedReceipt) {
                            return { status: 'complete', serializedReceipt: existing.serializedReceipt } as const;
                        }
                        if (input.reclaimPending !== true) {
                            return { status: 'pending' } as const;
                        }
                        persistRecords(
                            records.map((record) =>
                                record === existing ? { ...existing, updatedAt: Date.now() } : record
                            )
                        );
                        return { status: 'claimed' } as const;
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
                    return { status: 'claimed' } as const;
                });
                if (result.status === 'claimed') {
                    claimLeases.set(key, lease);
                    retainLease = true;
                }
                return result;
            } finally {
                if (!retainLease) {
                    lease.release();
                }
            }
        },
        async complete(input): Promise<void> {
            try {
                await requestExclusiveLock(() => {
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
            } finally {
                releaseClaimLease(input);
            }
        },
        async tryAcquireRecoveryLease(input): Promise<boolean> {
            const key = recordKey(input);
            if (claimLeases.has(key)) {
                return false;
            }
            const lease = await tryAcquireClaimLease(claimLockName(input));
            if (!lease) {
                return false;
            }
            let retainLease = false;
            try {
                await requestExclusiveLock(() => {
                    validateIdentity(input);
                    const existing = findRecord(decodeRecords(localStorage.getItem(STORAGE_KEY)), input);
                    if (existing && existing.contentHash !== input.contentHash) {
                        throw new Error('The durable idempotency claim conflicts with project recovery');
                    }
                });
                claimLeases.set(key, lease);
                retainLease = true;
                return true;
            } finally {
                if (!retainLease) {
                    lease.release();
                }
            }
        },
        async release(input): Promise<void> {
            try {
                await requestExclusiveLock(() => {
                    validateIdentity(input);
                    const records = decodeRecords(localStorage.getItem(STORAGE_KEY));
                    const existing = findRecord(records, input);
                    if (!existing || existing.contentHash !== input.contentHash || existing.state === 'complete') {
                        return;
                    }
                    persistRecords(records.filter((record) => record !== existing));
                });
            } finally {
                releaseClaimLease(input);
            }
        },
    };
}
