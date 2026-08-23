import {
    ASSET_STORE,
    LEASE_STORE,
    OWNER_AUTHORITY_SCHEMA_VERSION,
    OWNER_AUTHORITY_STORE,
    RECORD_SCHEMA_VERSION,
    type AssetRecord,
    type LeaseRecord,
    type OwnerAuthorityRecord,
} from './durableAssetIndexedDb';
import { createDurableAssetReceiptRetention } from './durableAssetReceiptRetention';
import { createDurableAssetRecordAccess } from './durableAssetRecordAccess';

const records = createDurableAssetRecordAccess();
const receipts = createDurableAssetReceiptRetention();

/** Own hash-bound stage, verified reopen, and exactly-once promotion for one opaque project owner. */
export function createDurableAssetStageLifecycle(ownerId: string) {
    return {
        async stageAsset(leaseId: string, blob: Blob, name: string) {
            const hash = await records.hashBlob(blob);
            const database = await records.openDurableAssetDatabase();
            const transaction = database.transaction([ASSET_STORE, LEASE_STORE, OWNER_AUTHORITY_STORE], 'readwrite');
            const completion = records.awaitTransaction(transaction);
            const assetStore = transaction.objectStore(ASSET_STORE);
            const leaseStore = transaction.objectStore(LEASE_STORE);
            const authorityStore = transaction.objectStore(OWNER_AUTHORITY_STORE);
            const [existingAsset, existingLease, authorityValue] = await Promise.all([
                records.readStoredValue(assetStore, hash),
                records.readStoredValue(leaseStore, leaseId),
                records.readStoredValue(authorityStore, ownerId),
            ]);
            if (
                authorityValue !== undefined &&
                (!records.isOwnerAuthorityRecord(authorityValue) || authorityValue.canonicalOwnerId !== ownerId)
            ) {
                transaction.abort();
                await completion.catch(() => undefined);
                throw new Error(`Collaboration asset owner authority moved: ${ownerId}`);
            }
            if (existingAsset !== undefined && !records.isAssetRecord(existingAsset)) {
                await completion;
                throw new Error(`Collaboration asset record is corrupt: ${hash}`);
            }
            if (
                existingLease !== undefined &&
                (!records.isLeaseRecord(existingLease) ||
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
                leaseOwnerIds: [...new Set([...activeLeases.map((lease) => lease.ownerId), ownerId])],
                activeLeases: activeLeases.some((lease) => lease.leaseId === leaseId)
                    ? activeLeases
                    : [...activeLeases, { leaseId, ownerId }],
            };
            assetStore.put(record);
            if (authorityValue === undefined) {
                authorityStore.put({
                    schemaVersion: OWNER_AUTHORITY_SCHEMA_VERSION,
                    ownerId,
                    canonicalOwnerId: ownerId,
                    epoch: 0,
                } satisfies OwnerAuthorityRecord);
            }
            leaseStore.put({
                schemaVersion: RECORD_SCHEMA_VERSION,
                leaseId,
                ownerId,
                hash,
                state: 'staged',
            } satisfies LeaseRecord);
            await completion;
            return { ...records.asDurableAsset(record), leaseId };
        },

        async reopenStagedAsset(leaseId: string, expectedHash: string) {
            const lease = await records.readLease(leaseId);
            if ('status' in lease) {
                return lease;
            }
            if (lease.ownerId !== ownerId) {
                return { status: 'failed' as const, reason: 'lease-owner-mismatch' as const };
            }
            if (lease.hash !== expectedHash) {
                return { status: 'failed' as const, reason: 'lease-hash-mismatch' as const };
            }
            if (lease.state === 'released') {
                return { status: 'failed' as const, reason: 'lease-terminal-conflict' as const };
            }
            const asset = await records.readAsset(lease.hash);
            if ('status' in asset) {
                return asset;
            }
            if (
                lease.state === 'staged' &&
                !asset.activeLeases.some((entry) => entry.leaseId === leaseId && entry.ownerId === ownerId)
            ) {
                return { status: 'failed' as const, reason: 'corrupt-record' as const };
            }
            if (lease.state === 'promoted' && !asset.ownerIds.includes(ownerId)) {
                return { status: 'failed' as const, reason: 'corrupt-record' as const };
            }
            return {
                status: 'opened' as const,
                leaseId,
                leaseState: lease.state,
                ...records.asDurableAsset(asset),
            };
        },

        async reopenDurableAsset(hash: string) {
            const asset = await records.readAsset(hash);
            if ('status' in asset) {
                return asset;
            }
            if (!asset.ownerIds.includes(ownerId)) {
                return { status: 'failed' as const, reason: 'asset-not-owned' as const };
            }
            return { status: 'opened' as const, ...records.asDurableAsset(asset) };
        },

        async promoteStagedAsset(leaseId: string, expectedHash: string) {
            const lease = await records.readLease(leaseId);
            if ('status' in lease) {
                return lease;
            }
            if (lease.ownerId !== ownerId) {
                return { status: 'failed' as const, reason: 'lease-owner-mismatch' as const };
            }
            if (lease.hash !== expectedHash) {
                return { status: 'failed' as const, reason: 'lease-hash-mismatch' as const };
            }
            if (lease.state === 'released') {
                return { status: 'failed' as const, reason: 'lease-terminal-conflict' as const };
            }
            const verified = await records.readAsset(lease.hash);
            if ('status' in verified) {
                return verified;
            }
            if (lease.state === 'promoted') {
                if (!verified.ownerIds.includes(ownerId)) {
                    return { status: 'failed' as const, reason: 'corrupt-record' as const };
                }
                await receipts.compactTerminalLeaseReceipts(ownerId);
                return {
                    status: 'already-promoted' as const,
                    leaseId,
                    ...records.asDurableAsset(verified),
                };
            }
            const database = await records.openDurableAssetDatabase();
            const transaction = database.transaction([ASSET_STORE, LEASE_STORE], 'readwrite');
            const assetStore = transaction.objectStore(ASSET_STORE);
            const leaseStore = transaction.objectStore(LEASE_STORE);
            const completion = records.awaitTransaction(transaction);
            const [currentAsset, currentLease] = await Promise.all([
                records.readStoredValue(assetStore, lease.hash),
                records.readStoredValue(leaseStore, leaseId),
            ]);
            if (!records.isAssetRecord(currentAsset) || !records.isLeaseRecord(currentLease)) {
                transaction.abort();
                await completion.catch(() => undefined);
                return { status: 'failed' as const, reason: 'corrupt-record' as const };
            }
            if (currentLease.ownerId !== ownerId) {
                transaction.abort();
                await completion.catch(() => undefined);
                return { status: 'failed' as const, reason: 'lease-owner-mismatch' as const };
            }
            if (currentLease.hash !== expectedHash) {
                transaction.abort();
                await completion.catch(() => undefined);
                return { status: 'failed' as const, reason: 'lease-hash-mismatch' as const };
            }
            if (currentLease.state === 'promoted') {
                if (
                    !currentAsset.ownerIds.includes(ownerId) ||
                    currentAsset.activeLeases.some((entry) => entry.leaseId === leaseId)
                ) {
                    transaction.abort();
                    await completion.catch(() => undefined);
                    return { status: 'failed' as const, reason: 'corrupt-record' as const };
                }
                await completion;
                await receipts.compactTerminalLeaseReceipts(ownerId);
                return {
                    status: 'already-promoted' as const,
                    leaseId,
                    ...records.asDurableAsset(currentAsset),
                };
            }
            if (
                currentLease.state !== 'staged' ||
                !currentAsset.activeLeases.some((entry) => entry.leaseId === leaseId && entry.ownerId === ownerId)
            ) {
                transaction.abort();
                await completion.catch(() => undefined);
                return {
                    status: 'failed' as const,
                    reason:
                        currentLease.state === 'released'
                            ? ('lease-terminal-conflict' as const)
                            : ('corrupt-record' as const),
                };
            }
            assetStore.put({
                ...currentAsset,
                ownerIds: [...new Set([...currentAsset.ownerIds, ownerId])],
                activeLeases: currentAsset.activeLeases.filter((entry) => entry.leaseId !== leaseId),
                leaseOwnerIds: [
                    ...new Set(
                        currentAsset.activeLeases
                            .filter((entry) => entry.leaseId !== leaseId)
                            .map((entry) => entry.ownerId)
                    ),
                ],
            } satisfies AssetRecord);
            leaseStore.put({ ...currentLease, state: 'promoted', terminalAt: Date.now() } satisfies LeaseRecord);
            await completion;
            await receipts.compactTerminalLeaseReceipts(ownerId);
            return { status: 'promoted' as const, leaseId, ...records.asDurableAsset(currentAsset) };
        },
    };
}
