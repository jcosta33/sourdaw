import {
    ASSET_LEASE_OWNER_INDEX,
    ASSET_OWNER_INDEX,
    ASSET_STORE,
    LEASE_OWNER_INDEX,
    LEASE_STORE,
    OWNER_HANDOFF_SCHEMA_VERSION,
    OWNER_HANDOFF_STORE,
    OWNER_HANDOFF_TARGET_INDEX,
    type AssetRecord,
    type LeaseRecord,
    type OwnerHandoffRecord,
} from './durableAssetIndexedDb';
import { createDurableAssetRecordAccess } from './durableAssetRecordAccess';
import { type RebindDurableAssetOwnerResult } from './durableAssetRepositoryContract';

const records = createDurableAssetRecordAccess();

async function commitOwnerRebind(previousOwnerId: string, nextOwnerId: string): Promise<RebindDurableAssetOwnerResult> {
    if (nextOwnerId === previousOwnerId) {
        return { status: 'rebound', previousOwnerId, ownerId: nextOwnerId, reboundHashes: [] };
    }
    const database = await records.openDurableAssetDatabase();
    const transaction = database.transaction([ASSET_STORE, LEASE_STORE, OWNER_HANDOFF_STORE], 'readwrite');
    const completion = records.awaitTransaction(transaction);
    const assetStore = transaction.objectStore(ASSET_STORE);
    const leaseStore = transaction.objectStore(LEASE_STORE);
    const handoffStore = transaction.objectStore(OWNER_HANDOFF_STORE);
    const [handoffValue, ownedAssetValues, leasedAssetValues, leaseValues] = await Promise.all([
        records.readStoredValue(handoffStore, previousOwnerId),
        records.readIndexedValues(assetStore, ASSET_OWNER_INDEX, previousOwnerId),
        records.readIndexedValues(assetStore, ASSET_LEASE_OWNER_INDEX, previousOwnerId),
        records.readIndexedValues(leaseStore, LEASE_OWNER_INDEX, previousOwnerId),
    ]);
    const indexedAssetValues = [...ownedAssetValues, ...leasedAssetValues];
    if (
        (handoffValue !== undefined && !records.isOwnerHandoffRecord(handoffValue)) ||
        indexedAssetValues.some((value) => !records.isAssetRecord(value)) ||
        leaseValues.some((value) => !records.isLeaseRecord(value))
    ) {
        transaction.abort();
        await completion.catch(() => undefined);
        return { status: 'failed', reason: 'corrupt-record' };
    }
    if (
        handoffValue !== undefined &&
        (handoffValue.previousOwnerId !== previousOwnerId || handoffValue.nextOwnerId !== nextOwnerId)
    ) {
        transaction.abort();
        await completion.catch(() => undefined);
        return { status: 'failed', reason: 'owner-handoff-conflict' };
    }
    if (handoffValue === undefined && (indexedAssetValues.length > 0 || leaseValues.length > 0)) {
        transaction.abort();
        await completion.catch(() => undefined);
        return { status: 'failed', reason: 'owner-handoff-conflict' };
    }

    const assets = [...new Map((indexedAssetValues as AssetRecord[]).map((value) => [value.hash, value])).values()];
    const reboundHashes: string[] = [];
    for (const asset of assets) {
        const ownsAsset = asset.ownerIds.includes(previousOwnerId);
        const ownsLease = asset.activeLeases.some((lease) => lease.ownerId === previousOwnerId);
        if (!ownsAsset && !ownsLease) {
            continue;
        }
        reboundHashes.push(asset.hash);
        const activeLeases = ownsLease
            ? asset.activeLeases.map((lease) =>
                  lease.ownerId === previousOwnerId ? { ...lease, ownerId: nextOwnerId } : lease
              )
            : asset.activeLeases;
        assetStore.put({
            ...asset,
            ownerIds: ownsAsset
                ? [...new Set(asset.ownerIds.map((id) => (id === previousOwnerId ? nextOwnerId : id)))]
                : asset.ownerIds,
            activeLeases,
            leaseOwnerIds: [...new Set(activeLeases.map((lease) => lease.ownerId))],
        } satisfies AssetRecord);
    }
    for (const lease of leaseValues as LeaseRecord[]) {
        if (lease.ownerId === previousOwnerId) {
            leaseStore.put({ ...lease, ownerId: nextOwnerId } satisfies LeaseRecord);
        }
    }
    if (handoffValue !== undefined) {
        handoffStore.delete(previousOwnerId);
    }
    await completion;
    for (const hash of reboundHashes) {
        records.notifyInvalidation({ hash, ownerId: previousOwnerId });
    }
    return { status: 'rebound', previousOwnerId, ownerId: nextOwnerId, reboundHashes };
}

/** Own crash-consistent prepare, commit, and target-keyed restart recovery for owner handoffs. */
export function createDurableAssetOwnerHandoffLifecycle(ownerId: string) {
    return {
        async prepareOwnerRebind(nextOwnerId: string) {
            if (nextOwnerId.length === 0) {
                throw new Error('Collaboration asset owner identity is required');
            }
            if (nextOwnerId === ownerId) {
                return { status: 'prepared' as const, previousOwnerId: ownerId, ownerId: nextOwnerId };
            }
            const database = await records.openDurableAssetDatabase();
            const transaction = database.transaction(OWNER_HANDOFF_STORE, 'readwrite');
            const completion = records.awaitTransaction(transaction);
            const store = transaction.objectStore(OWNER_HANDOFF_STORE);
            const existing = await records.readStoredValue(store, ownerId);
            if (existing !== undefined) {
                if (!records.isOwnerHandoffRecord(existing)) {
                    transaction.abort();
                    await completion.catch(() => undefined);
                    return { status: 'failed' as const, reason: 'corrupt-record' as const };
                }
                if (existing.nextOwnerId !== nextOwnerId) {
                    transaction.abort();
                    await completion.catch(() => undefined);
                    return { status: 'failed' as const, reason: 'owner-handoff-conflict' as const };
                }
                await completion;
                return { status: 'prepared' as const, previousOwnerId: ownerId, ownerId: nextOwnerId };
            }
            store.put({
                schemaVersion: OWNER_HANDOFF_SCHEMA_VERSION,
                previousOwnerId: ownerId,
                nextOwnerId,
                preparedAt: Date.now(),
            } satisfies OwnerHandoffRecord);
            await completion;
            return { status: 'prepared' as const, previousOwnerId: ownerId, ownerId: nextOwnerId };
        },

        commitOwnerRebind(nextOwnerId: string) {
            return commitOwnerRebind(ownerId, nextOwnerId);
        },

        async resumeOwnerRebinds() {
            const database = await records.openDurableAssetDatabase();
            const transaction = database.transaction(OWNER_HANDOFF_STORE, 'readonly');
            const completion = records.awaitTransaction(transaction);
            const values = await records.readIndexedValues(
                transaction.objectStore(OWNER_HANDOFF_STORE),
                OWNER_HANDOFF_TARGET_INDEX,
                ownerId
            );
            await completion;
            if (values.some((value) => !records.isOwnerHandoffRecord(value))) {
                return { status: 'failed' as const, reason: 'corrupt-record' as const };
            }
            const reboundHashes = new Set<string>();
            for (const handoff of values as OwnerHandoffRecord[]) {
                const result = await commitOwnerRebind(handoff.previousOwnerId, ownerId);
                if (result.status === 'failed') {
                    return result;
                }
                for (const hash of result.reboundHashes) {
                    reboundHashes.add(hash);
                }
            }
            return {
                status: 'resumed' as const,
                ownerId,
                handoffCount: values.length,
                reboundHashes: [...reboundHashes],
            };
        },
    };
}
