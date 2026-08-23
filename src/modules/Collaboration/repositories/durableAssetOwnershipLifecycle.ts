import {
    ASSET_LEASE_OWNER_INDEX,
    ASSET_OWNER_INDEX,
    ASSET_STORE,
    LEASE_OWNER_INDEX,
    LEASE_STORE,
    type AssetRecord,
    type LeaseRecord,
} from './durableAssetIndexedDb';
import { createDurableAssetReceiptRetention } from './durableAssetReceiptRetention';
import { createDurableAssetRecordAccess } from './durableAssetRecordAccess';
import {
    type DurableAssetFailure,
    type ReleasedStagedAsset,
    type ReleaseStagedAssetsResult,
    type StagedAssetBinding,
} from './durableAssetRepositoryContract';

const records = createDurableAssetRecordAccess();
const receipts = createDurableAssetReceiptRetention();

async function releaseStagedAssetSet(
    ownerId: string,
    bindings: readonly StagedAssetBinding[]
): Promise<ReleaseStagedAssetsResult> {
    const uniqueBindings = new Map<string, StagedAssetBinding>();
    for (const binding of bindings) {
        const existing = uniqueBindings.get(binding.leaseId);
        if (existing && existing.expectedHash !== binding.expectedHash) {
            return { status: 'failed', reason: 'lease-hash-mismatch' };
        }
        uniqueBindings.set(binding.leaseId, binding);
    }
    if (uniqueBindings.size === 0) {
        return { status: 'released', releases: [] };
    }

    // Verify every referenced blob before opening the write transaction. No
    // lease in the set may move if any hash binding or stored byte fails.
    const verifiedHashes = new Set<string>();
    const verifiedLeases = new Map<string, LeaseRecord>();
    for (const binding of uniqueBindings.values()) {
        const lease = await records.readLease(binding.leaseId);
        if ('status' in lease) {
            return lease;
        }
        if (lease.ownerId !== ownerId) {
            return { status: 'failed', reason: 'lease-owner-mismatch' };
        }
        if (lease.hash !== binding.expectedHash) {
            return { status: 'failed', reason: 'lease-hash-mismatch' };
        }
        if (lease.state === 'promoted') {
            return { status: 'failed', reason: 'lease-terminal-conflict' };
        }
        verifiedLeases.set(lease.leaseId, lease);
        if (!verifiedHashes.has(lease.hash)) {
            const asset = await records.readAsset(lease.hash);
            if ('status' in asset && !(lease.state === 'released' && asset.reason === 'missing-asset')) {
                return asset;
            }
            verifiedHashes.add(lease.hash);
        }
    }

    const database = await records.openDurableAssetDatabase();
    const transaction = database.transaction([ASSET_STORE, LEASE_STORE], 'readwrite');
    const assetStore = transaction.objectStore(ASSET_STORE);
    const leaseStore = transaction.objectStore(LEASE_STORE);
    const completion = records.awaitTransaction(transaction);
    // Enqueue both reads before yielding. IndexedDB may auto-commit a
    // transaction between promise turns when it has no outstanding requests.
    const leaseIds = [...uniqueBindings.keys()];
    const hashes = [...new Set([...verifiedLeases.values()].map((lease) => lease.hash))];
    const values = await Promise.all([
        ...leaseIds.map((leaseId) => records.readStoredValue(leaseStore, leaseId)),
        ...hashes.map((hash) => records.readStoredValue(assetStore, hash)),
    ]);
    const leaseValues = values.slice(0, leaseIds.length);
    const assetValues = values.slice(leaseIds.length);
    const leases = new Map(leaseIds.map((leaseId, index) => [leaseId, leaseValues[index]]));
    const assets = new Map(hashes.map((hash, index) => [hash, assetValues[index]]));
    const leaseEntries = [...uniqueBindings.values()].map((binding) => ({
        binding,
        value: leases.get(binding.leaseId),
    }));

    async function fail(reason: DurableAssetFailure['reason']): Promise<DurableAssetFailure> {
        transaction.abort();
        await completion.catch(() => undefined);
        return { status: 'failed', reason };
    }

    const releases: ReleasedStagedAsset[] = [];
    const nextAssets = new Map<string, AssetRecord | undefined>();
    const nextLeases = new Map<string, LeaseRecord>();
    for (const { binding, value } of leaseEntries) {
        if (!records.isLeaseRecord(value)) {
            return fail(value === undefined ? 'unknown-lease' : 'corrupt-record');
        }
        if (value.ownerId !== ownerId) {
            return fail('lease-owner-mismatch');
        }
        if (value.hash !== binding.expectedHash) {
            return fail('lease-hash-mismatch');
        }
        if (value.state === 'promoted') {
            return fail('lease-terminal-conflict');
        }
        const storedAsset = nextAssets.has(value.hash) ? nextAssets.get(value.hash) : assets.get(value.hash);
        if (value.state === 'released') {
            if (storedAsset !== undefined && !records.isAssetRecord(storedAsset)) {
                return fail('corrupt-record');
            }
            releases.push({
                status: 'already-released',
                leaseId: value.leaseId,
                hash: value.hash,
                assetRemoved: storedAsset === undefined,
                ownerRetained: storedAsset === undefined ? false : records.ownerRetained(storedAsset, ownerId),
            });
            continue;
        }
        if (!records.isAssetRecord(storedAsset)) {
            return fail(storedAsset === undefined ? 'missing-asset' : 'corrupt-record');
        }
        if (!storedAsset.activeLeases.some((entry) => entry.leaseId === value.leaseId && entry.ownerId === ownerId)) {
            return fail('corrupt-record');
        }
        const next: AssetRecord = {
            ...storedAsset,
            activeLeases: storedAsset.activeLeases.filter((entry) => entry.leaseId !== value.leaseId),
            leaseOwnerIds: [
                ...new Set(
                    storedAsset.activeLeases
                        .filter((entry) => entry.leaseId !== value.leaseId)
                        .map((entry) => entry.ownerId)
                ),
            ],
        };
        const assetRemoved = next.ownerIds.length === 0 && next.activeLeases.length === 0;
        nextAssets.set(value.hash, assetRemoved ? undefined : next);
        nextLeases.set(value.leaseId, { ...value, state: 'released', terminalAt: Date.now() });
        releases.push({
            status: 'released',
            leaseId: value.leaseId,
            hash: value.hash,
            assetRemoved,
            ownerRetained: !assetRemoved && records.ownerRetained(next, ownerId),
        });
    }

    for (const [hash, asset] of nextAssets) {
        if (asset) {
            assetStore.put(asset);
        } else {
            assetStore.delete(hash);
        }
    }
    for (const lease of nextLeases.values()) {
        leaseStore.put(lease);
    }
    await completion;
    await receipts.compactTerminalLeaseReceipts(ownerId);
    for (const release of releases) {
        if (release.status === 'released' && !release.ownerRetained) {
            records.notifyInvalidation(release.assetRemoved ? { hash: release.hash } : { hash: release.hash, ownerId });
        }
    }
    return { status: 'released', releases };
}

/** Own atomic release, exact-owner reclamation, and indexed owner rebinding. */
export function createDurableAssetOwnershipLifecycle(ownerId: string) {
    return {
        async releaseStagedAsset(leaseId: string, expectedHash: string) {
            const result = await releaseStagedAssetSet(ownerId, [{ leaseId, expectedHash }]);
            if (result.status === 'failed') {
                return result;
            }
            const release = result.releases[0];
            return release ?? { status: 'failed' as const, reason: 'corrupt-record' as const };
        },

        releaseStagedAssets(bindings: readonly StagedAssetBinding[]) {
            return releaseStagedAssetSet(ownerId, bindings);
        },

        async releaseOwnedAsset(hash: string) {
            const verified = await records.readAsset(hash);
            if ('status' in verified) {
                return verified;
            }
            if (!verified.ownerIds.includes(ownerId)) {
                return { status: 'failed' as const, reason: 'asset-not-owned' as const };
            }
            const database = await records.openDurableAssetDatabase();
            const transaction = database.transaction(ASSET_STORE, 'readwrite');
            const completion = records.awaitTransaction(transaction);
            const store = transaction.objectStore(ASSET_STORE);
            const current = await records.readStoredValue(store, hash);
            if (!records.isAssetRecord(current) || !current.ownerIds.includes(ownerId)) {
                transaction.abort();
                await completion.catch(() => undefined);
                return { status: 'failed' as const, reason: 'corrupt-record' as const };
            }
            const next: AssetRecord = { ...current, ownerIds: current.ownerIds.filter((id) => id !== ownerId) };
            const assetRemoved = next.ownerIds.length === 0 && next.activeLeases.length === 0;
            if (assetRemoved) {
                store.delete(hash);
            } else {
                store.put(next);
            }
            await completion;
            if (!records.ownerRetained(next, ownerId)) {
                records.notifyInvalidation(assetRemoved ? { hash } : { hash, ownerId });
            }
            return { status: 'released' as const, hash, assetRemoved };
        },

        async releaseOwner() {
            const database = await records.openDurableAssetDatabase();
            const transaction = database.transaction([ASSET_STORE, LEASE_STORE], 'readwrite');
            const completion = records.awaitTransaction(transaction);
            const assetStore = transaction.objectStore(ASSET_STORE);
            const leaseStore = transaction.objectStore(LEASE_STORE);
            const [ownedValues, leasedValues, leaseValues] = await Promise.all([
                records.readIndexedValues(assetStore, ASSET_OWNER_INDEX, ownerId),
                records.readIndexedValues(assetStore, ASSET_LEASE_OWNER_INDEX, ownerId),
                records.readIndexedValues(leaseStore, LEASE_OWNER_INDEX, ownerId),
            ]);
            if (
                ownedValues.some((value) => !records.isAssetRecord(value)) ||
                leasedValues.some((value) => !records.isAssetRecord(value)) ||
                leaseValues.some((value) => !records.isLeaseRecord(value))
            ) {
                transaction.abort();
                await completion.catch(() => undefined);
                throw new Error(`Collaboration asset ownership records are corrupt: ${ownerId}`);
            }
            const assets = new Map<string, AssetRecord>();
            const removedHashes = new Set<string>();
            for (const value of [...ownedValues, ...leasedValues] as AssetRecord[]) {
                assets.set(value.hash, value);
            }
            let removedAssets = 0;
            const releasedHashes: string[] = [];
            for (const asset of assets.values()) {
                const activeLeases = asset.activeLeases.filter((lease) => lease.ownerId !== ownerId);
                const next: AssetRecord = {
                    ...asset,
                    ownerIds: asset.ownerIds.filter((id) => id !== ownerId),
                    activeLeases,
                    leaseOwnerIds: [...new Set(activeLeases.map((lease) => lease.ownerId))],
                };
                releasedHashes.push(asset.hash);
                if (next.ownerIds.length === 0 && next.activeLeases.length === 0) {
                    assetStore.delete(asset.hash);
                    removedAssets += 1;
                    removedHashes.add(asset.hash);
                } else {
                    assetStore.put(next);
                }
            }
            for (const lease of leaseValues as LeaseRecord[]) {
                leaseStore.delete(lease.leaseId);
            }
            await completion;
            for (const hash of releasedHashes) {
                records.notifyInvalidation(removedHashes.has(hash) ? { hash } : { hash, ownerId });
            }
            return {
                status: 'released' as const,
                ownerId,
                releasedHashes,
                removedAssets,
                compactedLeases: leaseValues.length,
            };
        },
    };
}
