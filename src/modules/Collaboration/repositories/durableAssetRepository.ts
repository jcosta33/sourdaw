const DATABASE_NAME = 'sourdaw-collaboration-original-assets';
const DATABASE_VERSION = 1;
const ASSET_STORE = 'assets';
const LEASE_STORE = 'leases';
const RECORD_SCHEMA_VERSION = 1;

type LeaseState = 'staged' | 'promoted' | 'released';

type AssetRecord = {
    schemaVersion: typeof RECORD_SCHEMA_VERSION;
    hash: string;
    blob: Blob;
    name: string;
    durable: boolean;
    activeLeaseIds: string[];
};

type LeaseRecord = {
    schemaVersion: typeof RECORD_SCHEMA_VERSION;
    leaseId: string;
    hash: string;
    state: LeaseState;
    releaseRemovedAsset?: boolean;
};

export type DurableAsset = {
    hash: string;
    blob: Blob;
    name: string;
};

export type DurableAssetFailure = {
    status: 'failed';
    reason:
        | 'unknown-lease'
        | 'lease-hash-mismatch'
        | 'missing-asset'
        | 'stored-hash-mismatch'
        | 'corrupt-record'
        | 'lease-terminal-conflict'
        | 'asset-not-promoted';
};

export type ReopenStagedAssetResult =
    | ({ status: 'opened'; leaseId: string; leaseState: Exclude<LeaseState, 'released'> } & DurableAsset)
    | DurableAssetFailure;

export type ReopenDurableAssetResult = ({ status: 'opened' } & DurableAsset) | DurableAssetFailure;

export type PromoteStagedAssetResult =
    ({ status: 'promoted' | 'already-promoted'; leaseId: string } & DurableAsset) | DurableAssetFailure;

export type ReleaseStagedAssetResult =
    | {
          status: 'released' | 'already-released';
          leaseId: string;
          hash: string;
          assetRemoved: boolean;
      }
    | DurableAssetFailure;

export type DurableAssetRepository = {
    storeDurableAsset: (blob: Blob, name: string, verifiedHash?: string) => Promise<DurableAsset>;
    stageAsset: (blob: Blob, name: string) => Promise<DurableAsset & { leaseId: string }>;
    reopenStagedAsset: (leaseId: string, expectedHash: string) => Promise<ReopenStagedAssetResult>;
    reopenDurableAsset: (hash: string) => Promise<ReopenDurableAssetResult>;
    promoteStagedAsset: (leaseId: string, expectedHash?: string) => Promise<PromoteStagedAssetResult>;
    releaseStagedAsset: (leaseId: string, expectedHash?: string) => Promise<ReleaseStagedAssetResult>;
};

let databasePromise: Promise<IDBDatabase> | null = null;

function unavailableError(cause?: unknown): Error {
    return new Error('Collaboration asset storage is unavailable', {
        cause: cause ?? new Error('IndexedDB is unavailable'),
    });
}

function openDatabase(): Promise<IDBDatabase> {
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
        request.onupgradeneeded = () => {
            const database = request.result;
            if (!database.objectStoreNames.contains(ASSET_STORE)) {
                database.createObjectStore(ASSET_STORE, { keyPath: 'hash' });
            }
            if (!database.objectStoreNames.contains(LEASE_STORE)) {
                database.createObjectStore(LEASE_STORE, { keyPath: 'leaseId' });
            }
        };
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
        typeof record.durable === 'boolean' &&
        Array.isArray(record.activeLeaseIds) &&
        record.activeLeaseIds.every((leaseId) => typeof leaseId === 'string')
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
        typeof record.hash === 'string' &&
        (record.state === 'staged' || record.state === 'promoted' || record.state === 'released') &&
        (record.releaseRemovedAsset === undefined || typeof record.releaseRemovedAsset === 'boolean')
    );
}

async function hashBlob(blob: Blob): Promise<string> {
    const buffer = await blob.arrayBuffer();
    const digest = await crypto.subtle.digest('SHA-256', buffer);
    const bytes = Array.from(new Uint8Array(digest));
    return `sha256:${bytes.map((byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}

async function readLease(leaseId: string): Promise<LeaseRecord | DurableAssetFailure> {
    const database = await openDatabase();
    const transaction = database.transaction(LEASE_STORE, 'readonly');
    const completion = awaitTransaction(transaction);
    const value = await readStoredValue(transaction.objectStore(LEASE_STORE), leaseId);
    await completion;
    if (value === undefined) {
        return { status: 'failed', reason: 'unknown-lease' };
    }
    if (!isLeaseRecord(value) || value.leaseId !== leaseId) {
        return { status: 'failed', reason: 'corrupt-record' };
    }
    return value;
}

async function readAsset(hash: string): Promise<AssetRecord | DurableAssetFailure> {
    const database = await openDatabase();
    const transaction = database.transaction(ASSET_STORE, 'readonly');
    const completion = awaitTransaction(transaction);
    const value = await readStoredValue(transaction.objectStore(ASSET_STORE), hash);
    await completion;
    if (value === undefined) {
        return { status: 'failed', reason: 'missing-asset' };
    }
    if (!isAssetRecord(value)) {
        return { status: 'failed', reason: 'corrupt-record' };
    }
    if (value.hash !== hash || (await hashBlob(value.blob)) !== hash) {
        return { status: 'failed', reason: 'stored-hash-mismatch' };
    }
    return value;
}

function asDurableAsset(record: AssetRecord): DurableAsset {
    return { hash: record.hash, blob: record.blob, name: record.name };
}

/**
 * Own content-addressed original bytes and their staging leases in IndexedDB.
 * AssetTransfer is a disposable transport/cache consumer of this owner.
 */
export function createDurableAssetRepository(): DurableAssetRepository {
    return {
        async storeDurableAsset(blob, name, verifiedHash) {
            const hash = verifiedHash ?? (await hashBlob(blob));
            const database = await openDatabase();
            const transaction = database.transaction(ASSET_STORE, 'readwrite');
            const completion = awaitTransaction(transaction);
            const store = transaction.objectStore(ASSET_STORE);
            const existing = await readStoredValue(store, hash);
            if (existing !== undefined && !isAssetRecord(existing)) {
                await completion;
                throw new Error(`Collaboration asset record is corrupt: ${hash}`);
            }
            const activeLeaseIds = isAssetRecord(existing) ? existing.activeLeaseIds : [];
            const record: AssetRecord = {
                schemaVersion: RECORD_SCHEMA_VERSION,
                hash,
                blob,
                name,
                durable: true,
                activeLeaseIds,
            };
            store.put(record);
            await completion;
            return asDurableAsset(record);
        },

        async stageAsset(blob, name) {
            const hash = await hashBlob(blob);
            const leaseId = `asset-stage-${crypto.randomUUID()}`;
            const database = await openDatabase();
            const transaction = database.transaction([ASSET_STORE, LEASE_STORE], 'readwrite');
            const completion = awaitTransaction(transaction);
            const assetStore = transaction.objectStore(ASSET_STORE);
            const leaseStore = transaction.objectStore(LEASE_STORE);
            const [existingAsset, existingLease] = await Promise.all([
                readStoredValue(assetStore, hash),
                readStoredValue(leaseStore, leaseId),
            ]);
            if (existingLease !== undefined) {
                await completion;
                throw new Error(`Collaboration staging lease collision: ${leaseId}`);
            }
            if (existingAsset !== undefined && !isAssetRecord(existingAsset)) {
                await completion;
                throw new Error(`Collaboration asset record is corrupt: ${hash}`);
            }
            const activeLeaseIds = existingAsset?.activeLeaseIds ?? [];
            const record: AssetRecord = {
                schemaVersion: RECORD_SCHEMA_VERSION,
                hash,
                blob: existingAsset?.blob ?? blob,
                name: existingAsset?.name ?? name,
                durable: existingAsset?.durable ?? false,
                activeLeaseIds: [...activeLeaseIds, leaseId],
            };
            const lease: LeaseRecord = {
                schemaVersion: RECORD_SCHEMA_VERSION,
                leaseId,
                hash,
                state: 'staged',
            };
            assetStore.put(record);
            leaseStore.put(lease);
            await completion;
            return { ...asDurableAsset(record), leaseId };
        },

        async reopenStagedAsset(leaseId, expectedHash) {
            const lease = await readLease(leaseId);
            if ('status' in lease) {
                return lease;
            }
            if (lease.hash !== expectedHash) {
                return { status: 'failed', reason: 'lease-hash-mismatch' };
            }
            if (lease.state === 'released') {
                return { status: 'failed', reason: 'lease-terminal-conflict' };
            }
            const asset = await readAsset(lease.hash);
            if ('status' in asset) {
                return asset;
            }
            if (!asset.activeLeaseIds.includes(leaseId) && lease.state === 'staged') {
                return { status: 'failed', reason: 'corrupt-record' };
            }
            return {
                status: 'opened',
                leaseId,
                leaseState: lease.state,
                ...asDurableAsset(asset),
            };
        },

        async reopenDurableAsset(hash) {
            const asset = await readAsset(hash);
            if ('status' in asset) {
                return asset;
            }
            if (!asset.durable) {
                return { status: 'failed', reason: 'asset-not-promoted' };
            }
            return { status: 'opened', ...asDurableAsset(asset) };
        },

        async promoteStagedAsset(leaseId, expectedHash) {
            const lease = await readLease(leaseId);
            if ('status' in lease) {
                return lease;
            }
            if (expectedHash !== undefined && lease.hash !== expectedHash) {
                return { status: 'failed', reason: 'lease-hash-mismatch' };
            }
            if (lease.state === 'released') {
                return { status: 'failed', reason: 'lease-terminal-conflict' };
            }
            const verified = await readAsset(lease.hash);
            if ('status' in verified) {
                return verified;
            }
            if (lease.state === 'promoted') {
                return { status: 'already-promoted', leaseId, ...asDurableAsset(verified) };
            }
            if (!verified.activeLeaseIds.includes(leaseId)) {
                return { status: 'failed', reason: 'corrupt-record' };
            }

            const database = await openDatabase();
            const transaction = database.transaction([ASSET_STORE, LEASE_STORE], 'readwrite');
            const completion = awaitTransaction(transaction);
            const assetStore = transaction.objectStore(ASSET_STORE);
            const leaseStore = transaction.objectStore(LEASE_STORE);
            const [currentAsset, currentLease] = await Promise.all([
                readStoredValue(assetStore, lease.hash),
                readStoredValue(leaseStore, leaseId),
            ]);
            if (!isAssetRecord(currentAsset) || !isLeaseRecord(currentLease)) {
                transaction.abort();
                try {
                    await completion;
                } catch {
                    // The typed failure below owns this expected abort.
                }
                return { status: 'failed', reason: 'corrupt-record' };
            }
            if (currentLease.hash !== lease.hash) {
                transaction.abort();
                try {
                    await completion;
                } catch {
                    // The typed failure below owns this expected abort.
                }
                return { status: 'failed', reason: 'lease-hash-mismatch' };
            }
            if (currentLease.state === 'released') {
                transaction.abort();
                try {
                    await completion;
                } catch {
                    // The typed failure below owns this expected abort.
                }
                return { status: 'failed', reason: 'lease-terminal-conflict' };
            }
            if (currentLease.state === 'promoted') {
                await completion;
                return { status: 'already-promoted', leaseId, ...asDurableAsset(currentAsset) };
            }
            if (!currentAsset.activeLeaseIds.includes(leaseId)) {
                transaction.abort();
                try {
                    await completion;
                } catch {
                    // The typed failure below owns this expected abort.
                }
                return { status: 'failed', reason: 'corrupt-record' };
            }
            assetStore.put({
                ...currentAsset,
                durable: true,
                activeLeaseIds: currentAsset.activeLeaseIds.filter((id) => id !== leaseId),
            } satisfies AssetRecord);
            leaseStore.put({ ...currentLease, state: 'promoted' } satisfies LeaseRecord);
            await completion;
            return { status: 'promoted', leaseId, ...asDurableAsset(currentAsset) };
        },

        async releaseStagedAsset(leaseId, expectedHash) {
            const lease = await readLease(leaseId);
            if ('status' in lease) {
                return lease;
            }
            if (expectedHash !== undefined && lease.hash !== expectedHash) {
                return { status: 'failed', reason: 'lease-hash-mismatch' };
            }
            if (lease.state === 'promoted') {
                return { status: 'failed', reason: 'lease-terminal-conflict' };
            }
            if (lease.state === 'released') {
                return {
                    status: 'already-released',
                    leaseId,
                    hash: lease.hash,
                    assetRemoved: lease.releaseRemovedAsset ?? false,
                };
            }
            const verified = await readAsset(lease.hash);
            if ('status' in verified) {
                return verified;
            }
            if (!verified.activeLeaseIds.includes(leaseId)) {
                return { status: 'failed', reason: 'corrupt-record' };
            }

            const database = await openDatabase();
            const transaction = database.transaction([ASSET_STORE, LEASE_STORE], 'readwrite');
            const completion = awaitTransaction(transaction);
            const assetStore = transaction.objectStore(ASSET_STORE);
            const leaseStore = transaction.objectStore(LEASE_STORE);
            const [currentAsset, currentLease] = await Promise.all([
                readStoredValue(assetStore, lease.hash),
                readStoredValue(leaseStore, leaseId),
            ]);
            if (!isAssetRecord(currentAsset) || !isLeaseRecord(currentLease)) {
                transaction.abort();
                try {
                    await completion;
                } catch {
                    // The typed failure below owns this expected abort.
                }
                return { status: 'failed', reason: 'corrupt-record' };
            }
            if (currentLease.hash !== lease.hash) {
                transaction.abort();
                try {
                    await completion;
                } catch {
                    // The typed failure below owns this expected abort.
                }
                return { status: 'failed', reason: 'lease-hash-mismatch' };
            }
            if (currentLease.state === 'promoted') {
                transaction.abort();
                try {
                    await completion;
                } catch {
                    // The typed failure below owns this expected abort.
                }
                return { status: 'failed', reason: 'lease-terminal-conflict' };
            }
            if (currentLease.state === 'released') {
                await completion;
                return {
                    status: 'already-released',
                    leaseId,
                    hash: lease.hash,
                    assetRemoved: currentLease.releaseRemovedAsset ?? false,
                };
            }
            if (!currentAsset.activeLeaseIds.includes(leaseId)) {
                transaction.abort();
                try {
                    await completion;
                } catch {
                    // The typed failure below owns this expected abort.
                }
                return { status: 'failed', reason: 'corrupt-record' };
            }
            const activeLeaseIds = currentAsset.activeLeaseIds.filter((id) => id !== leaseId);
            const assetRemoved = !currentAsset.durable && activeLeaseIds.length === 0;
            if (assetRemoved) {
                assetStore.delete(lease.hash);
            } else {
                assetStore.put({ ...currentAsset, activeLeaseIds } satisfies AssetRecord);
            }
            leaseStore.put({
                ...currentLease,
                state: 'released',
                releaseRemovedAsset: assetRemoved,
            } satisfies LeaseRecord);
            await completion;
            return { status: 'released', leaseId, hash: lease.hash, assetRemoved };
        },
    };
}
