import {
    ASSET_STORE,
    LEASE_STORE,
    type AssetRecord,
    type LeaseRecord,
    createDurableAssetIndexedDb,
} from './durableAssetIndexedDb';
import { type AssetInvalidation, type DurableAsset, type DurableAssetFailure } from './durableAssetRepositoryContract';

const indexedDb = createDurableAssetIndexedDb();
const invalidationListeners = new Set<(event: AssetInvalidation) => void>();

async function readLease(leaseId: string): Promise<LeaseRecord | DurableAssetFailure> {
    const database = await indexedDb.openDurableAssetDatabase();
    const transaction = database.transaction(LEASE_STORE, 'readonly');
    const completion = indexedDb.awaitTransaction(transaction);
    const value = await indexedDb.readStoredValue(transaction.objectStore(LEASE_STORE), leaseId);
    await completion;
    if (value === undefined) {
        return { status: 'failed', reason: 'unknown-lease' };
    }
    if (!indexedDb.isLeaseRecord(value) || value.leaseId !== leaseId) {
        return { status: 'failed', reason: 'corrupt-record' };
    }
    return value;
}

async function readAsset(hash: string): Promise<AssetRecord | DurableAssetFailure> {
    const database = await indexedDb.openDurableAssetDatabase();
    const transaction = database.transaction(ASSET_STORE, 'readonly');
    const completion = indexedDb.awaitTransaction(transaction);
    const value = await indexedDb.readStoredValue(transaction.objectStore(ASSET_STORE), hash);
    await completion;
    if (value === undefined) {
        return { status: 'failed', reason: 'missing-asset' };
    }
    if (!indexedDb.isAssetRecord(value)) {
        return { status: 'failed', reason: 'corrupt-record' };
    }
    if (value.hash !== hash || (await indexedDb.hashBlob(value.blob)) !== hash) {
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

/** Share verified record access and the process-local cache invalidation bus across lifecycle owners. */
export function createDurableAssetRecordAccess() {
    return {
        ...indexedDb,
        asDurableAsset,
        notifyInvalidation,
        ownerRetained,
        readAsset,
        readLease,
        subscribeInvalidation(listener: (event: AssetInvalidation) => void): () => void {
            invalidationListeners.add(listener);
            return () => invalidationListeners.delete(listener);
        },
    };
}
