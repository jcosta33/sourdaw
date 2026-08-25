import {
    ASSET_LEASE_OWNER_INDEX,
    ASSET_OWNER_INDEX,
    ASSET_STORE,
    LEASE_OWNER_INDEX,
    LEASE_STORE,
    OWNER_HANDOFF_SCHEMA_VERSION,
    OWNER_HANDOFF_STORE,
    OWNER_HANDOFF_TARGET_INDEX,
    OWNER_AUTHORITY_SCHEMA_VERSION,
    OWNER_AUTHORITY_STORE,
    PROMOTION_RECOVERY_OWNER_INDEX,
    PROMOTION_RECOVERY_STORE,
    type AssetRecord,
    type LeaseRecord,
    type OwnerHandoffRecord,
    type OwnerAuthorityRecord,
    type PromotionRecoveryRecord,
} from './durableAssetIndexedDb';
import { createDurableAssetRecordAccess } from './durableAssetRecordAccess';
import { createDurableAssetRecoveryFenceGuard } from './durableAssetRecoveryFence';
import { type DurableAssetRecoveryFence, type RebindDurableAssetOwnerResult } from './durableAssetRepositoryContract';

const records = createDurableAssetRecordAccess();
type OwnerRebindAttemptResult = RebindDurableAssetOwnerResult | { status: 'cancelled'; ownerId: string };

function haveSameStringSet(left: readonly string[], right: readonly string[]): boolean {
    const leftSet = new Set(left);
    const rightSet = new Set(right);
    return leftSet.size === rightSet.size && [...leftSet].every((value) => rightSet.has(value));
}

async function commitOwnerRebind(
    previousOwnerId: string,
    nextOwnerId: string,
    fence?: DurableAssetRecoveryFence
): Promise<OwnerRebindAttemptResult> {
    const fenceGuard = createDurableAssetRecoveryFenceGuard(fence);
    if (nextOwnerId === previousOwnerId) {
        const database = await records.openDurableAssetDatabase();
        const transaction = database.transaction(OWNER_HANDOFF_STORE, 'readwrite');
        const completion = records.awaitTransaction(transaction);
        const store = transaction.objectStore(OWNER_HANDOFF_STORE);
        const handoffValue = await records.readStoredValue(store, previousOwnerId);
        if (handoffValue !== undefined) {
            if (!records.isOwnerHandoffRecord(handoffValue)) {
                transaction.abort();
                await completion.catch(() => undefined);
                return { status: 'failed', reason: 'corrupt-record' };
            }
            if (handoffValue.previousOwnerId !== previousOwnerId || handoffValue.nextOwnerId !== nextOwnerId) {
                transaction.abort();
                await completion.catch(() => undefined);
                return { status: 'failed', reason: 'owner-handoff-conflict' };
            }
            fenceGuard.bind(transaction, completion);
            if (!fenceGuard.isCurrent()) {
                fenceGuard.abort(transaction);
                await completion.catch(() => undefined);
                return { status: 'cancelled', ownerId: nextOwnerId };
            }
            store.delete(previousOwnerId);
        }
        try {
            await completion;
        } catch (error) {
            if (!fenceGuard.isCurrent()) {
                return { status: 'cancelled', ownerId: nextOwnerId };
            }
            throw error;
        }
        return { status: 'rebound', previousOwnerId, ownerId: nextOwnerId, reboundHashes: [] };
    }
    const database = await records.openDurableAssetDatabase();
    const transaction = database.transaction(
        [ASSET_STORE, LEASE_STORE, OWNER_HANDOFF_STORE, OWNER_AUTHORITY_STORE, PROMOTION_RECOVERY_STORE],
        'readwrite'
    );
    const completion = records.awaitTransaction(transaction);
    const assetStore = transaction.objectStore(ASSET_STORE);
    const leaseStore = transaction.objectStore(LEASE_STORE);
    const handoffStore = transaction.objectStore(OWNER_HANDOFF_STORE);
    const promotionStore = transaction.objectStore(PROMOTION_RECOVERY_STORE);
    const authorityStore = transaction.objectStore(OWNER_AUTHORITY_STORE);
    const [
        handoffValue,
        ownedAssetValues,
        leasedAssetValues,
        leaseValues,
        promotionValues,
        authorityValue,
        nextAuthority,
    ] = await Promise.all([
        records.readStoredValue(handoffStore, previousOwnerId),
        records.readIndexedValues(assetStore, ASSET_OWNER_INDEX, previousOwnerId),
        records.readIndexedValues(assetStore, ASSET_LEASE_OWNER_INDEX, previousOwnerId),
        records.readIndexedValues(leaseStore, LEASE_OWNER_INDEX, previousOwnerId),
        records.readIndexedValues(promotionStore, PROMOTION_RECOVERY_OWNER_INDEX, previousOwnerId),
        records.readStoredValue(authorityStore, previousOwnerId),
        records.readStoredValue(authorityStore, nextOwnerId),
    ]);
    const indexedAssetValues = [...ownedAssetValues, ...leasedAssetValues];
    if (
        (handoffValue !== undefined && !records.isOwnerHandoffRecord(handoffValue)) ||
        indexedAssetValues.some((value) => !records.isAssetRecord(value)) ||
        leaseValues.some((value) => !records.isLeaseRecord(value)) ||
        promotionValues.some((value) => !records.isPromotionRecoveryRecord(value)) ||
        (authorityValue !== undefined && !records.isOwnerAuthorityRecord(authorityValue))
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
    if (handoffValue !== undefined) {
        // Queue deletion inside this same transaction before any later awaits
        // can leave an otherwise empty handoff transaction inactive. A later
        // validation failure aborts and rolls this mutation back atomically.
        fenceGuard.bind(transaction, completion);
        if (!fenceGuard.isCurrent()) {
            fenceGuard.abort(transaction);
            await completion.catch(() => undefined);
            return { status: 'cancelled', ownerId: nextOwnerId };
        }
        handoffStore.delete(previousOwnerId);
    }
    const authorityEpoch = records.isOwnerAuthorityRecord(authorityValue) ? authorityValue.epoch : 0;
    if (
        records.isOwnerAuthorityRecord(authorityValue) &&
        authorityValue.canonicalOwnerId !== previousOwnerId &&
        authorityValue.canonicalOwnerId !== nextOwnerId
    ) {
        transaction.abort();
        await completion.catch(() => undefined);
        return { status: 'failed', reason: 'owner-handoff-conflict' };
    }
    if (!fenceGuard.isCurrent()) {
        fenceGuard.abort(transaction);
        await completion.catch(() => undefined);
        return { status: 'cancelled', ownerId: nextOwnerId };
    }
    authorityStore.put({
        schemaVersion: OWNER_AUTHORITY_SCHEMA_VERSION,
        ownerId: previousOwnerId,
        canonicalOwnerId: nextOwnerId,
        epoch: authorityEpoch + 1,
    } satisfies OwnerAuthorityRecord);
    if (nextAuthority === undefined) {
        if (!fenceGuard.isCurrent()) {
            fenceGuard.abort(transaction);
            await completion.catch(() => undefined);
            return { status: 'cancelled', ownerId: nextOwnerId };
        }
        authorityStore.put({
            schemaVersion: OWNER_AUTHORITY_SCHEMA_VERSION,
            ownerId: nextOwnerId,
            canonicalOwnerId: nextOwnerId,
            epoch: 0,
        } satisfies OwnerAuthorityRecord);
    } else if (!records.isOwnerAuthorityRecord(nextAuthority) || nextAuthority.canonicalOwnerId !== nextOwnerId) {
        transaction.abort();
        await completion.catch(() => undefined);
        return { status: 'failed', reason: 'owner-handoff-conflict' };
    }
    for (const recovery of promotionValues as PromotionRecoveryRecord[]) {
        if (recovery.ownerId !== previousOwnerId) {
            transaction.abort();
            await completion.catch(() => undefined);
            return { status: 'failed', reason: 'corrupt-record' };
        }
        if (!fenceGuard.isCurrent()) {
            fenceGuard.abort(transaction);
            await completion.catch(() => undefined);
            return { status: 'cancelled', ownerId: nextOwnerId };
        }
        promotionStore.put({ ...recovery, ownerId: nextOwnerId } satisfies PromotionRecoveryRecord);
    }

    const leases = leaseValues as LeaseRecord[];
    const ownerIndexedHashes = new Set((ownedAssetValues as AssetRecord[]).map((asset) => asset.hash));
    const leaseOwnerIndexedHashes = new Set((leasedAssetValues as AssetRecord[]).map((asset) => asset.hash));
    const directlyReadAssetValues = await Promise.all(
        leases.map((lease) => records.readStoredValue(assetStore, lease.hash))
    );
    const directlyReadAssets = new Map<string, AssetRecord>();
    let backlinksAreValid = true;
    for (const [index, lease] of leases.entries()) {
        const assetValue = directlyReadAssetValues[index];
        if (lease.ownerId !== previousOwnerId) {
            backlinksAreValid = false;
            break;
        }
        if (assetValue === undefined) {
            if (lease.state !== 'released') {
                backlinksAreValid = false;
                break;
            }
            continue;
        }
        if (!records.isAssetRecord(assetValue) || assetValue.hash !== lease.hash) {
            backlinksAreValid = false;
            break;
        }
        directlyReadAssets.set(assetValue.hash, assetValue);
        const matchingBacklinks = assetValue.activeLeases.filter((entry) => entry.leaseId === lease.leaseId);
        if (
            (lease.state === 'staged' &&
                (matchingBacklinks.length !== 1 || matchingBacklinks[0]?.ownerId !== previousOwnerId)) ||
            (lease.state !== 'staged' && matchingBacklinks.length > 0) ||
            (lease.state === 'promoted' && !assetValue.ownerIds.includes(previousOwnerId))
        ) {
            backlinksAreValid = false;
            break;
        }
    }
    const indexedAssets = [
        ...new Map((indexedAssetValues as AssetRecord[]).map((asset) => [asset.hash, asset])).values(),
    ];
    const validatedAssets = [
        ...new Map([...indexedAssets, ...directlyReadAssets.values()].map((asset) => [asset.hash, asset])).values(),
    ];
    for (const asset of validatedAssets) {
        const derivedLeaseOwnerIds = asset.activeLeases.map((lease) => lease.ownerId);
        const selectedByOwnerIndex = ownerIndexedHashes.has(asset.hash);
        const selectedByLeaseOwnerIndex = leaseOwnerIndexedHashes.has(asset.hash);
        if (
            asset.hash.length === 0 ||
            !haveSameStringSet(asset.leaseOwnerIds, derivedLeaseOwnerIds) ||
            (selectedByOwnerIndex && !asset.ownerIds.includes(previousOwnerId)) ||
            (selectedByLeaseOwnerIndex && !asset.leaseOwnerIds.includes(previousOwnerId))
        ) {
            backlinksAreValid = false;
            break;
        }
        for (const backlink of asset.activeLeases) {
            if (backlink.ownerId !== previousOwnerId) {
                continue;
            }
            const lease = leases.find((candidate) => candidate.leaseId === backlink.leaseId);
            if (!lease || lease.hash !== asset.hash || lease.ownerId !== previousOwnerId || lease.state !== 'staged') {
                backlinksAreValid = false;
                break;
            }
        }
    }
    if (!backlinksAreValid) {
        transaction.abort();
        await completion.catch(() => undefined);
        return { status: 'failed', reason: 'corrupt-record' };
    }

    const assets = validatedAssets;
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
        if (!fenceGuard.isCurrent()) {
            fenceGuard.abort(transaction);
            await completion.catch(() => undefined);
            return { status: 'cancelled', ownerId: nextOwnerId };
        }
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
            if (!fenceGuard.isCurrent()) {
                fenceGuard.abort(transaction);
                await completion.catch(() => undefined);
                return { status: 'cancelled', ownerId: nextOwnerId };
            }
            leaseStore.put({ ...lease, ownerId: nextOwnerId } satisfies LeaseRecord);
        }
    }
    try {
        await completion;
    } catch (error) {
        if (!fenceGuard.isCurrent()) {
            return { status: 'cancelled', ownerId: nextOwnerId };
        }
        throw error;
    }
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
                const consumed = await commitOwnerRebind(ownerId, nextOwnerId);
                if (consumed.status === 'failed') {
                    return consumed;
                }
                return {
                    status: 'prepared' as const,
                    previousOwnerId: ownerId,
                    ownerId: nextOwnerId,
                    created: false,
                };
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
                return {
                    status: 'prepared' as const,
                    previousOwnerId: ownerId,
                    ownerId: nextOwnerId,
                    created: false,
                };
            }
            store.put({
                schemaVersion: OWNER_HANDOFF_SCHEMA_VERSION,
                previousOwnerId: ownerId,
                nextOwnerId,
                preparedAt: Date.now(),
            } satisfies OwnerHandoffRecord);
            await completion;
            return {
                status: 'prepared' as const,
                previousOwnerId: ownerId,
                ownerId: nextOwnerId,
                created: true,
            };
        },

        async commitOwnerRebind(nextOwnerId: string): Promise<RebindDurableAssetOwnerResult> {
            const result = await commitOwnerRebind(ownerId, nextOwnerId);
            if (result.status === 'cancelled') {
                throw new Error('Unfenced durable owner rebind was unexpectedly cancelled');
            }
            return result;
        },

        async abortOwnerRebind(nextOwnerId: string) {
            const database = await records.openDurableAssetDatabase();
            const transaction = database.transaction(OWNER_HANDOFF_STORE, 'readwrite');
            const completion = records.awaitTransaction(transaction);
            const store = transaction.objectStore(OWNER_HANDOFF_STORE);
            const outgoing = await records.readStoredValue(store, ownerId);
            if (outgoing === undefined) {
                await completion;
                return { status: 'missing' as const, previousOwnerId: ownerId, ownerId: nextOwnerId };
            }
            if (!records.isOwnerHandoffRecord(outgoing)) {
                transaction.abort();
                await completion.catch(() => undefined);
                return { status: 'failed' as const, reason: 'corrupt-record' as const };
            }
            if (outgoing.nextOwnerId !== nextOwnerId) {
                transaction.abort();
                await completion.catch(() => undefined);
                return { status: 'failed' as const, reason: 'owner-handoff-conflict' as const };
            }
            store.delete(ownerId);
            await completion;
            return { status: 'aborted' as const, previousOwnerId: ownerId, ownerId: nextOwnerId };
        },

        async resumeOwnerRebinds(fence?: DurableAssetRecoveryFence) {
            const fenceGuard = createDurableAssetRecoveryFenceGuard(fence);
            const database = await records.openDurableAssetDatabase();
            const transaction = database.transaction(OWNER_HANDOFF_STORE, 'readonly');
            const completion = records.awaitTransaction(transaction);
            const store = transaction.objectStore(OWNER_HANDOFF_STORE);
            const values = await records.readIndexedValues(store, OWNER_HANDOFF_TARGET_INDEX, ownerId);
            await completion;
            if (values.some((value) => !records.isOwnerHandoffRecord(value))) {
                return { status: 'failed' as const, reason: 'corrupt-record' as const };
            }
            if (!fenceGuard.isCurrent()) {
                return { status: 'cancelled' as const, ownerId };
            }
            const reboundHashes = new Set<string>();
            for (const handoff of values as OwnerHandoffRecord[]) {
                const result = await commitOwnerRebind(handoff.previousOwnerId, ownerId, fence);
                if (result.status === 'cancelled') {
                    return result;
                }
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
                previousOwnerIds: (values as OwnerHandoffRecord[]).map((handoff) => handoff.previousOwnerId),
                reboundHashes: [...reboundHashes],
            };
        },
    };
}
