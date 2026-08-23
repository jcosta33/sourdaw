const DATABASE_NAME = 'sourdaw-collaboration-original-assets';
const DATABASE_VERSION = 4;
export const ASSET_STORE = 'assets';
export const LEASE_STORE = 'leases';
export const ASSET_OWNER_INDEX = 'by-owner';
export const ASSET_LEASE_OWNER_INDEX = 'by-lease-owner';
export const LEASE_OWNER_INDEX = 'by-owner';
export const OWNER_HANDOFF_STORE = 'ownerHandoffs';
export const OWNER_HANDOFF_TARGET_INDEX = 'by-next-owner';
export const PROMOTION_RECOVERY_STORE = 'promotionRecoveries';
export const PROMOTION_RECOVERY_OWNER_INDEX = 'by-owner';
export const PROMOTION_RECOVERY_LEASE_INDEX = 'by-lease';
export const RECORD_SCHEMA_VERSION = 2;
export const OWNER_HANDOFF_SCHEMA_VERSION = 1;
export const PROMOTION_RECOVERY_SCHEMA_VERSION = 1;

export type LeaseState = 'staged' | 'promoted' | 'released';
export type ActiveLease = { leaseId: string; ownerId: string };
export type AssetRecord = {
    schemaVersion: typeof RECORD_SCHEMA_VERSION;
    hash: string;
    blob: Blob;
    name: string;
    ownerIds: string[];
    leaseOwnerIds: string[];
    activeLeases: ActiveLease[];
};
export type LeaseRecord = {
    schemaVersion: typeof RECORD_SCHEMA_VERSION;
    leaseId: string;
    ownerId: string;
    hash: string;
    state: LeaseState;
    terminalAt?: number;
};
export type OwnerHandoffRecord = {
    schemaVersion: typeof OWNER_HANDOFF_SCHEMA_VERSION;
    previousOwnerId: string;
    nextOwnerId: string;
    preparedAt: number;
};
export type PromotionRecoveryRecord = {
    schemaVersion: typeof PROMOTION_RECOVERY_SCHEMA_VERSION;
    recoveryId: string;
    ownerId: string;
    leaseIds: string[];
    bindings: Array<{ leaseId: string; expectedHash: string }>;
    disposition?: 'promote' | 'release';
    preparedAt: number;
};

let databasePromise: Promise<IDBDatabase> | null = null;

function unavailableError(cause?: unknown): Error {
    return new Error('Collaboration asset storage is unavailable', {
        cause: cause ?? new Error('IndexedDB is unavailable'),
    });
}

function migrateVersionOneRecords(assetStore: IDBObjectStore, leaseStore: IDBObjectStore): void {
    const assetCursor = assetStore.openCursor();
    assetCursor.onsuccess = () => {
        const cursor = assetCursor.result;
        if (!cursor) {
            return;
        }
        const rawValue: unknown = cursor.value;
        if (typeof rawValue !== 'object' || rawValue === null) {
            cursor.continue();
            return;
        }
        const value = rawValue as Record<string, unknown>;
        const activeLeases: unknown[] = Array.isArray(value.activeLeases) ? value.activeLeases : [];
        cursor.update({
            ...value,
            schemaVersion: RECORD_SCHEMA_VERSION,
            leaseOwnerIds: [
                ...new Set(
                    activeLeases.flatMap((lease) =>
                        typeof lease === 'object' &&
                        lease !== null &&
                        'ownerId' in lease &&
                        typeof lease.ownerId === 'string'
                            ? [lease.ownerId]
                            : []
                    )
                ),
            ],
        });
        cursor.continue();
    };
    const leaseCursor = leaseStore.openCursor();
    leaseCursor.onsuccess = () => {
        const cursor = leaseCursor.result;
        if (!cursor) {
            return;
        }
        const rawValue: unknown = cursor.value;
        if (typeof rawValue !== 'object' || rawValue === null) {
            cursor.continue();
            return;
        }
        const value = rawValue as Record<string, unknown>;
        cursor.update({
            ...value,
            schemaVersion: RECORD_SCHEMA_VERSION,
            ...(value.state === 'staged' ? {} : { terminalAt: Date.now() }),
        });
        cursor.continue();
    };
}

function ensureIndexes(request: IDBOpenDBRequest, oldVersion: number): void {
    const database = request.result;
    const assetStore = database.objectStoreNames.contains(ASSET_STORE)
        ? request.transaction!.objectStore(ASSET_STORE)
        : database.createObjectStore(ASSET_STORE, { keyPath: 'hash' });
    if (!assetStore.indexNames.contains(ASSET_OWNER_INDEX)) {
        assetStore.createIndex(ASSET_OWNER_INDEX, 'ownerIds', { multiEntry: true });
    }
    if (!assetStore.indexNames.contains(ASSET_LEASE_OWNER_INDEX)) {
        assetStore.createIndex(ASSET_LEASE_OWNER_INDEX, 'leaseOwnerIds', { multiEntry: true });
    }
    const leaseStore = database.objectStoreNames.contains(LEASE_STORE)
        ? request.transaction!.objectStore(LEASE_STORE)
        : database.createObjectStore(LEASE_STORE, { keyPath: 'leaseId' });
    if (!leaseStore.indexNames.contains(LEASE_OWNER_INDEX)) {
        leaseStore.createIndex(LEASE_OWNER_INDEX, 'ownerId');
    }
    const handoffStore = database.objectStoreNames.contains(OWNER_HANDOFF_STORE)
        ? request.transaction!.objectStore(OWNER_HANDOFF_STORE)
        : database.createObjectStore(OWNER_HANDOFF_STORE, { keyPath: 'previousOwnerId' });
    if (!handoffStore.indexNames.contains(OWNER_HANDOFF_TARGET_INDEX)) {
        handoffStore.createIndex(OWNER_HANDOFF_TARGET_INDEX, 'nextOwnerId');
    }
    const promotionRecoveryStore = database.objectStoreNames.contains(PROMOTION_RECOVERY_STORE)
        ? request.transaction!.objectStore(PROMOTION_RECOVERY_STORE)
        : database.createObjectStore(PROMOTION_RECOVERY_STORE, { keyPath: 'recoveryId' });
    if (!promotionRecoveryStore.indexNames.contains(PROMOTION_RECOVERY_OWNER_INDEX)) {
        promotionRecoveryStore.createIndex(PROMOTION_RECOVERY_OWNER_INDEX, 'ownerId');
    }
    if (!promotionRecoveryStore.indexNames.contains(PROMOTION_RECOVERY_LEASE_INDEX)) {
        promotionRecoveryStore.createIndex(PROMOTION_RECOVERY_LEASE_INDEX, 'leaseIds', { multiEntry: true });
    }
    if (oldVersion === 1) {
        migrateVersionOneRecords(assetStore, leaseStore);
    }
}

function openDurableAssetDatabase(): Promise<IDBDatabase> {
    if (databasePromise) {
        return databasePromise;
    }
    const promise = new Promise<IDBDatabase>((resolve, reject) => {
        if (typeof globalThis.indexedDB === 'undefined') {
            reject(unavailableError());
            return;
        }
        let request: IDBOpenDBRequest;
        try {
            request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
        } catch (error) {
            reject(unavailableError(error));
            return;
        }
        request.onupgradeneeded = (event) => ensureIndexes(request, event.oldVersion);
        request.onsuccess = () => {
            const database = request.result;
            database.onversionchange = () => {
                database.close();
                if (databasePromise === promise) {
                    databasePromise = null;
                }
            };
            resolve(database);
        };
        request.onerror = () => reject(unavailableError(request.error));
        request.onblocked = () => reject(unavailableError(new Error('IndexedDB upgrade was blocked')));
    });
    databasePromise = promise;
    void promise.catch(() => {
        if (databasePromise === promise) {
            databasePromise = null;
        }
    });
    return promise;
}

function awaitRequest<Result>(request: IDBRequest<Result>): Promise<Result> {
    return new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'));
    });
}

function readStoredValue(store: IDBObjectStore, key: string): Promise<unknown> {
    return awaitRequest(store.get(key) as IDBRequest<unknown>);
}

function readIndexedValues(store: IDBObjectStore, indexName: string, key: string): Promise<unknown[]> {
    return awaitRequest(store.index(indexName).getAll(key) as IDBRequest<unknown[]>);
}

function awaitTransaction(transaction: IDBTransaction): Promise<void> {
    return new Promise((resolve, reject) => {
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB transaction failed'));
        transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB transaction aborted'));
    });
}

function isAssetRecord(value: unknown): value is AssetRecord {
    if (typeof value !== 'object' || value === null) {
        return false;
    }
    const record = value as Record<string, unknown>;
    return (
        record.schemaVersion === RECORD_SCHEMA_VERSION &&
        typeof record.hash === 'string' &&
        record.blob instanceof Blob &&
        typeof record.name === 'string' &&
        Array.isArray(record.ownerIds) &&
        record.ownerIds.every((ownerId) => typeof ownerId === 'string') &&
        Array.isArray(record.leaseOwnerIds) &&
        record.leaseOwnerIds.every((ownerId) => typeof ownerId === 'string') &&
        Array.isArray(record.activeLeases) &&
        record.activeLeases.every(
            (lease) =>
                typeof lease === 'object' &&
                lease !== null &&
                typeof (lease as ActiveLease).leaseId === 'string' &&
                typeof (lease as ActiveLease).ownerId === 'string'
        )
    );
}

function isLeaseRecord(value: unknown): value is LeaseRecord {
    if (typeof value !== 'object' || value === null) {
        return false;
    }
    const record = value as Record<string, unknown>;
    return (
        record.schemaVersion === RECORD_SCHEMA_VERSION &&
        typeof record.leaseId === 'string' &&
        typeof record.ownerId === 'string' &&
        typeof record.hash === 'string' &&
        (record.state === 'staged' || record.state === 'promoted' || record.state === 'released') &&
        (record.state === 'staged'
            ? record.terminalAt === undefined
            : typeof record.terminalAt === 'number' && Number.isSafeInteger(record.terminalAt))
    );
}

function isOwnerHandoffRecord(value: unknown): value is OwnerHandoffRecord {
    if (typeof value !== 'object' || value === null) {
        return false;
    }
    const record = value as Record<string, unknown>;
    return (
        record.schemaVersion === OWNER_HANDOFF_SCHEMA_VERSION &&
        typeof record.previousOwnerId === 'string' &&
        typeof record.nextOwnerId === 'string' &&
        typeof record.preparedAt === 'number' &&
        Number.isSafeInteger(record.preparedAt)
    );
}

function isPromotionRecoveryRecord(value: unknown): value is PromotionRecoveryRecord {
    if (typeof value !== 'object' || value === null) {
        return false;
    }
    const record = value as Record<string, unknown>;
    const recoveryLeaseIds = Array.isArray(record.leaseIds)
        ? record.leaseIds.filter((leaseId): leaseId is string => typeof leaseId === 'string')
        : [];
    if (
        record.schemaVersion !== PROMOTION_RECOVERY_SCHEMA_VERSION ||
        typeof record.recoveryId !== 'string' ||
        record.recoveryId.length === 0 ||
        typeof record.ownerId !== 'string' ||
        record.ownerId.length === 0 ||
        !Array.isArray(record.leaseIds) ||
        recoveryLeaseIds.length !== record.leaseIds.length ||
        !Array.isArray(record.bindings) ||
        record.bindings.length === 0 ||
        (record.disposition !== undefined && record.disposition !== 'promote' && record.disposition !== 'release') ||
        typeof record.preparedAt !== 'number' ||
        !Number.isSafeInteger(record.preparedAt)
    ) {
        return false;
    }
    const leaseIds = new Set<string>();
    for (const binding of record.bindings) {
        if (
            typeof binding !== 'object' ||
            binding === null ||
            typeof (binding as { leaseId?: unknown }).leaseId !== 'string' ||
            (binding as { leaseId: string }).leaseId.length === 0 ||
            typeof (binding as { expectedHash?: unknown }).expectedHash !== 'string' ||
            (binding as { expectedHash: string }).expectedHash.length === 0 ||
            leaseIds.has((binding as { leaseId: string }).leaseId)
        ) {
            return false;
        }
        leaseIds.add((binding as { leaseId: string }).leaseId);
    }
    return leaseIds.size === recoveryLeaseIds.length && recoveryLeaseIds.every((leaseId) => leaseIds.has(leaseId));
}

async function hashBlob(blob: Blob): Promise<string> {
    const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
    return `sha256:${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}

/** Construct the bounded IndexedDB record/transaction adapter. */
export function createDurableAssetIndexedDb() {
    return {
        awaitTransaction,
        hashBlob,
        isAssetRecord,
        isLeaseRecord,
        isOwnerHandoffRecord,
        isPromotionRecoveryRecord,
        openDurableAssetDatabase,
        readIndexedValues,
        readStoredValue,
    };
}
