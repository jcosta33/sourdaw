const DATABASE_NAME = 'sourdaw-collaboration-original-assets';
const DATABASE_VERSION = 1;
const ASSET_STORE = 'assets';
const LEASE_STORE = 'leases';
const RECORD_SCHEMA_VERSION = 1;

type LeaseState = 'staged' | 'promoted' | 'released';
type ActiveLease = { leaseId: string; ownerId: string };
type AssetRecord = {
    schemaVersion: typeof RECORD_SCHEMA_VERSION;
    hash: string;
    blob: Blob;
    name: string;
    ownerIds: string[];
    activeLeases: ActiveLease[];
};
type LeaseRecord = {
    schemaVersion: typeof RECORD_SCHEMA_VERSION;
    leaseId: string;
    ownerId: string;
    hash: string;
    state: LeaseState;
};

export type DurableAsset = { hash: string; blob: Blob; name: string };
export type DurableAssetFailure = {
    status: 'failed';
    reason:
        | 'unknown-lease'
        | 'lease-owner-mismatch'
        | 'lease-hash-mismatch'
        | 'missing-asset'
        | 'stored-hash-mismatch'
        | 'corrupt-record'
        | 'lease-terminal-conflict'
        | 'asset-not-owned';
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
          ownerRetained: boolean;
      }
    | DurableAssetFailure;
export type ReleaseOwnedAssetResult = { status: 'released'; hash: string; assetRemoved: boolean } | DurableAssetFailure;
export type RebindDurableAssetOwnerResult =
    { status: 'rebound'; previousOwnerId: string; ownerId: string; reboundHashes: string[] } | DurableAssetFailure;
export type ReconcileOwnedAssetsResult =
    { status: 'reconciled'; releasedHashes: string[]; removedHashes: string[] } | DurableAssetFailure;

type AssetInvalidation = { hash: string; ownerId?: string };
const invalidationListeners = new Set<(event: AssetInvalidation) => void>();

export type DurableAssetRepository = {
    storeDurableAsset: (blob: Blob, name: string, verifiedHash?: string) => Promise<DurableAsset>;
    stageAsset: (leaseId: string, blob: Blob, name: string) => Promise<DurableAsset & { leaseId: string }>;
    reopenStagedAsset: (leaseId: string, expectedHash: string) => Promise<ReopenStagedAssetResult>;
    reopenDurableAsset: (hash: string) => Promise<ReopenDurableAssetResult>;
    promoteStagedAsset: (leaseId: string, expectedHash: string) => Promise<PromoteStagedAssetResult>;
    releaseStagedAsset: (leaseId: string, expectedHash: string) => Promise<ReleaseStagedAssetResult>;
    releaseOwnedAsset: (hash: string) => Promise<ReleaseOwnedAssetResult>;
    rebindOwner: (nextOwnerId: string) => Promise<RebindDurableAssetOwnerResult>;
    reconcileOwnedAssets: (referencedHashes: readonly string[]) => Promise<ReconcileOwnedAssetsResult>;
    subscribeInvalidation: (listener: (event: AssetInvalidation) => void) => () => void;
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

function readAllStoredValues(store: IDBObjectStore): Promise<unknown[]> {
    return awaitRequest(store.getAll() as IDBRequest<unknown[]>);
}

function awaitTransaction(transaction: IDBTransaction): Promise<void> {
    return new Promise((resolve, reject) => {
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB transaction failed'));
        transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB transaction aborted'));
    });
}

function isActiveLease(value: unknown): value is ActiveLease {
    return (
        typeof value === 'object' &&
        value !== null &&
        typeof (value as ActiveLease).leaseId === 'string' &&
        typeof (value as ActiveLease).ownerId === 'string'
    );
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
        Array.isArray(record.activeLeases) &&
        record.activeLeases.every(isActiveLease)
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
        (record.state === 'staged' || record.state === 'promoted' || record.state === 'released')
    );
}

async function hashBlob(blob: Blob): Promise<string> {
    const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
    return `sha256:${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
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

function ownerRetained(record: AssetRecord, ownerId: string): boolean {
    return record.ownerIds.includes(ownerId) || record.activeLeases.some((lease) => lease.ownerId === ownerId);
}

function notifyInvalidation(event: AssetInvalidation): void {
    for (const listener of invalidationListeners) {
        listener(event);
    }
}

/** Own content-addressed originals for one opaque Collaboration project identity. */
export function createDurableAssetRepository(ownerId: string): DurableAssetRepository {
    if (ownerId.length === 0) {
        throw new Error('Collaboration asset owner identity is required');
    }
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
            const record: AssetRecord = {
                schemaVersion: RECORD_SCHEMA_VERSION,
                hash,
                blob,
                name,
                ownerIds: [...new Set([...(existing?.ownerIds ?? []), ownerId])],
                activeLeases: existing?.activeLeases ?? [],
            };
            store.put(record);
            await completion;
            return asDurableAsset(record);
        },

        async stageAsset(leaseId, blob, name) {
            const hash = await hashBlob(blob);
            const database = await openDatabase();
            const transaction = database.transaction([ASSET_STORE, LEASE_STORE], 'readwrite');
            const completion = awaitTransaction(transaction);
            const assetStore = transaction.objectStore(ASSET_STORE);
            const leaseStore = transaction.objectStore(LEASE_STORE);
            const [existingAsset, existingLease] = await Promise.all([
                readStoredValue(assetStore, hash),
                readStoredValue(leaseStore, leaseId),
            ]);
            if (existingAsset !== undefined && !isAssetRecord(existingAsset)) {
                await completion;
                throw new Error(`Collaboration asset record is corrupt: ${hash}`);
            }
            if (
                existingLease !== undefined &&
                (!isLeaseRecord(existingLease) ||
                    existingLease.ownerId !== ownerId ||
                    existingLease.hash !== hash ||
                    existingLease.state !== 'staged')
            ) {
                await completion;
                throw new Error(`Collaboration staging lease conflict: ${leaseId}`);
            }
            const activeLeases = existingAsset?.activeLeases ?? [];
            const record: AssetRecord = {
                schemaVersion: RECORD_SCHEMA_VERSION,
                hash,
                blob,
                name,
                ownerIds: existingAsset?.ownerIds ?? [],
                activeLeases: activeLeases.some((lease) => lease.leaseId === leaseId)
                    ? activeLeases
                    : [...activeLeases, { leaseId, ownerId }],
            };
            assetStore.put(record);
            if (existingLease === undefined) {
                leaseStore.put({
                    schemaVersion: RECORD_SCHEMA_VERSION,
                    leaseId,
                    ownerId,
                    hash,
                    state: 'staged',
                } satisfies LeaseRecord);
            }
            await completion;
            return { ...asDurableAsset(record), leaseId };
        },

        async reopenStagedAsset(leaseId, expectedHash) {
            const lease = await readLease(leaseId);
            if ('status' in lease) {
                return lease;
            }
            if (lease.ownerId !== ownerId) {
                return { status: 'failed', reason: 'lease-owner-mismatch' };
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
            if (
                lease.state === 'staged' &&
                !asset.activeLeases.some((entry) => entry.leaseId === leaseId && entry.ownerId === ownerId)
            ) {
                return { status: 'failed', reason: 'corrupt-record' };
            }
            if (lease.state === 'promoted' && !asset.ownerIds.includes(ownerId)) {
                return { status: 'failed', reason: 'corrupt-record' };
            }
            return { status: 'opened', leaseId, leaseState: lease.state, ...asDurableAsset(asset) };
        },

        async reopenDurableAsset(hash) {
            const asset = await readAsset(hash);
            if ('status' in asset) {
                return asset;
            }
            if (!ownerRetained(asset, ownerId)) {
                return { status: 'failed', reason: 'asset-not-owned' };
            }
            return { status: 'opened', ...asDurableAsset(asset) };
        },

        async promoteStagedAsset(leaseId, expectedHash) {
            const lease = await readLease(leaseId);
            if ('status' in lease) {
                return lease;
            }
            if (lease.ownerId !== ownerId) {
                return { status: 'failed', reason: 'lease-owner-mismatch' };
            }
            if (lease.hash !== expectedHash) {
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
                if (!verified.ownerIds.includes(ownerId)) {
                    return { status: 'failed', reason: 'corrupt-record' };
                }
                return { status: 'already-promoted', leaseId, ...asDurableAsset(verified) };
            }
            const database = await openDatabase();
            const transaction = database.transaction([ASSET_STORE, LEASE_STORE], 'readwrite');
            const assetStore = transaction.objectStore(ASSET_STORE);
            const leaseStore = transaction.objectStore(LEASE_STORE);
            const completion = awaitTransaction(transaction);
            const [currentAsset, currentLease] = await Promise.all([
                readStoredValue(assetStore, lease.hash),
                readStoredValue(leaseStore, leaseId),
            ]);
            if (!isAssetRecord(currentAsset) || !isLeaseRecord(currentLease)) {
                transaction.abort();
                await completion.catch(() => undefined);
                return { status: 'failed', reason: 'corrupt-record' };
            }
            if (currentLease.ownerId !== ownerId) {
                transaction.abort();
                await completion.catch(() => undefined);
                return { status: 'failed', reason: 'lease-owner-mismatch' };
            }
            if (currentLease.hash !== expectedHash) {
                transaction.abort();
                await completion.catch(() => undefined);
                return { status: 'failed', reason: 'lease-hash-mismatch' };
            }
            if (
                currentLease.state !== 'staged' ||
                !currentAsset.activeLeases.some((entry) => entry.leaseId === leaseId && entry.ownerId === ownerId)
            ) {
                transaction.abort();
                await completion.catch(() => undefined);
                return {
                    status: 'failed',
                    reason: currentLease.state === 'released' ? 'lease-terminal-conflict' : 'corrupt-record',
                };
            }
            assetStore.put({
                ...currentAsset,
                ownerIds: [...new Set([...currentAsset.ownerIds, ownerId])],
                activeLeases: currentAsset.activeLeases.filter((entry) => entry.leaseId !== leaseId),
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
            if (lease.ownerId !== ownerId) {
                return { status: 'failed', reason: 'lease-owner-mismatch' };
            }
            if (lease.hash !== expectedHash) {
                return { status: 'failed', reason: 'lease-hash-mismatch' };
            }
            if (lease.state === 'promoted') {
                return { status: 'failed', reason: 'lease-terminal-conflict' };
            }
            if (lease.state === 'released') {
                const current = await readAsset(lease.hash);
                if ('status' in current) {
                    if (current.reason === 'missing-asset') {
                        return {
                            status: 'already-released',
                            leaseId,
                            hash: lease.hash,
                            assetRemoved: true,
                            ownerRetained: false,
                        };
                    }
                    return current;
                }
                return {
                    status: 'already-released',
                    leaseId,
                    hash: lease.hash,
                    assetRemoved: false,
                    ownerRetained: ownerRetained(current, ownerId),
                };
            }
            const verified = await readAsset(lease.hash);
            if ('status' in verified) {
                return verified;
            }
            const database = await openDatabase();
            const transaction = database.transaction([ASSET_STORE, LEASE_STORE], 'readwrite');
            const assetStore = transaction.objectStore(ASSET_STORE);
            const leaseStore = transaction.objectStore(LEASE_STORE);
            const completion = awaitTransaction(transaction);
            const [currentAsset, currentLease] = await Promise.all([
                readStoredValue(assetStore, lease.hash),
                readStoredValue(leaseStore, leaseId),
            ]);
            if (!isAssetRecord(currentAsset) || !isLeaseRecord(currentLease)) {
                transaction.abort();
                await completion.catch(() => undefined);
                return { status: 'failed', reason: 'corrupt-record' };
            }
            if (currentLease.ownerId !== ownerId) {
                transaction.abort();
                await completion.catch(() => undefined);
                return { status: 'failed', reason: 'lease-owner-mismatch' };
            }
            if (currentLease.hash !== expectedHash) {
                transaction.abort();
                await completion.catch(() => undefined);
                return { status: 'failed', reason: 'lease-hash-mismatch' };
            }
            if (currentLease.state !== 'staged') {
                transaction.abort();
                await completion.catch(() => undefined);
                return { status: 'failed', reason: 'lease-terminal-conflict' };
            }
            if (!currentAsset.activeLeases.some((entry) => entry.leaseId === leaseId && entry.ownerId === ownerId)) {
                transaction.abort();
                await completion.catch(() => undefined);
                return { status: 'failed', reason: 'corrupt-record' };
            }
            const next: AssetRecord = {
                ...currentAsset,
                activeLeases: currentAsset.activeLeases.filter((entry) => entry.leaseId !== leaseId),
            };
            const assetRemoved = next.ownerIds.length === 0 && next.activeLeases.length === 0;
            if (assetRemoved) {
                assetStore.delete(lease.hash);
            } else {
                assetStore.put(next);
            }
            leaseStore.put({ ...currentLease, state: 'released' } satisfies LeaseRecord);
            await completion;
            const retained = !assetRemoved && ownerRetained(next, ownerId);
            if (!retained) {
                notifyInvalidation(assetRemoved ? { hash: lease.hash } : { hash: lease.hash, ownerId });
            }
            return { status: 'released', leaseId, hash: lease.hash, assetRemoved, ownerRetained: retained };
        },

        async releaseOwnedAsset(hash) {
            const verified = await readAsset(hash);
            if ('status' in verified) {
                return verified;
            }
            if (!verified.ownerIds.includes(ownerId)) {
                return { status: 'failed', reason: 'asset-not-owned' };
            }
            const database = await openDatabase();
            const transaction = database.transaction(ASSET_STORE, 'readwrite');
            const completion = awaitTransaction(transaction);
            const store = transaction.objectStore(ASSET_STORE);
            const current = await readStoredValue(store, hash);
            if (!isAssetRecord(current) || !current.ownerIds.includes(ownerId)) {
                transaction.abort();
                await completion.catch(() => undefined);
                return { status: 'failed', reason: 'corrupt-record' };
            }
            const next: AssetRecord = { ...current, ownerIds: current.ownerIds.filter((id) => id !== ownerId) };
            const assetRemoved = next.ownerIds.length === 0 && next.activeLeases.length === 0;
            if (assetRemoved) {
                store.delete(hash);
            } else {
                store.put(next);
            }
            await completion;
            if (!ownerRetained(next, ownerId)) {
                notifyInvalidation(assetRemoved ? { hash } : { hash, ownerId });
            }
            return { status: 'released', hash, assetRemoved };
        },

        async rebindOwner(nextOwnerId) {
            if (nextOwnerId.length === 0) {
                throw new Error('Collaboration asset owner identity is required');
            }
            if (nextOwnerId === ownerId) {
                return { status: 'rebound', previousOwnerId: ownerId, ownerId: nextOwnerId, reboundHashes: [] };
            }
            const database = await openDatabase();
            const transaction = database.transaction([ASSET_STORE, LEASE_STORE], 'readwrite');
            const completion = awaitTransaction(transaction);
            const assetStore = transaction.objectStore(ASSET_STORE);
            const leaseStore = transaction.objectStore(LEASE_STORE);
            const [assetValues, leaseValues] = await Promise.all([
                readAllStoredValues(assetStore),
                readAllStoredValues(leaseStore),
            ]);
            if (
                assetValues.some((value) => !isAssetRecord(value)) ||
                leaseValues.some((value) => !isLeaseRecord(value))
            ) {
                transaction.abort();
                await completion.catch(() => undefined);
                return { status: 'failed', reason: 'corrupt-record' };
            }

            const assets = assetValues as AssetRecord[];
            const leases = leaseValues as LeaseRecord[];
            const reboundHashes: string[] = [];
            for (const asset of assets) {
                const ownsAsset = asset.ownerIds.includes(ownerId);
                const ownsLease = asset.activeLeases.some((lease) => lease.ownerId === ownerId);
                if (!ownsAsset && !ownsLease) {
                    continue;
                }
                reboundHashes.push(asset.hash);
                assetStore.put({
                    ...asset,
                    ownerIds: ownsAsset
                        ? [...new Set(asset.ownerIds.map((id) => (id === ownerId ? nextOwnerId : id)))]
                        : asset.ownerIds,
                    activeLeases: ownsLease
                        ? asset.activeLeases.map((lease) =>
                              lease.ownerId === ownerId ? { ...lease, ownerId: nextOwnerId } : lease
                          )
                        : asset.activeLeases,
                } satisfies AssetRecord);
            }
            for (const lease of leases) {
                if (lease.ownerId === ownerId) {
                    leaseStore.put({ ...lease, ownerId: nextOwnerId } satisfies LeaseRecord);
                }
            }
            await completion;
            for (const hash of reboundHashes) {
                notifyInvalidation({ hash, ownerId });
            }
            return { status: 'rebound', previousOwnerId: ownerId, ownerId: nextOwnerId, reboundHashes };
        },

        async reconcileOwnedAssets(referencedHashes) {
            const referenced = new Set(referencedHashes);
            const database = await openDatabase();
            const transaction = database.transaction(ASSET_STORE, 'readwrite');
            const completion = awaitTransaction(transaction);
            const store = transaction.objectStore(ASSET_STORE);
            const values = await readAllStoredValues(store);
            if (values.some((value) => !isAssetRecord(value))) {
                transaction.abort();
                await completion.catch(() => undefined);
                return { status: 'failed', reason: 'corrupt-record' };
            }

            const releasedHashes: string[] = [];
            const removedHashes: string[] = [];
            const invalidatedHashes: string[] = [];
            for (const asset of values as AssetRecord[]) {
                if (!asset.ownerIds.includes(ownerId) || referenced.has(asset.hash)) {
                    continue;
                }
                releasedHashes.push(asset.hash);
                const next: AssetRecord = {
                    ...asset,
                    ownerIds: asset.ownerIds.filter((id) => id !== ownerId),
                };
                if (next.ownerIds.length === 0 && next.activeLeases.length === 0) {
                    store.delete(asset.hash);
                    removedHashes.push(asset.hash);
                    invalidatedHashes.push(asset.hash);
                } else {
                    store.put(next);
                    if (!ownerRetained(next, ownerId)) {
                        invalidatedHashes.push(asset.hash);
                    }
                }
            }
            await completion;
            for (const hash of invalidatedHashes) {
                notifyInvalidation(removedHashes.includes(hash) ? { hash } : { hash, ownerId });
            }
            return { status: 'reconciled', releasedHashes, removedHashes };
        },

        subscribeInvalidation(listener) {
            invalidationListeners.add(listener);
            return () => invalidationListeners.delete(listener);
        },
    };
}
