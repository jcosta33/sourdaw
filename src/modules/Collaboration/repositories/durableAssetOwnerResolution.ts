import { PROMOTION_RECOVERY_STORE } from './durableAssetIndexedDb';
import { createDurableAssetRecordAccess } from './durableAssetRecordAccess';
import { type StagedAssetBinding } from './durableAssetRepositoryContract';

const records = createDurableAssetRecordAccess();

async function resolveBindingOwner(bindings: readonly StagedAssetBinding[]) {
    if (bindings.length === 0) {
        return { status: 'failed' as const, reason: 'corrupt-record' as const };
    }
    const leases = await Promise.all(bindings.map((binding) => records.readLease(binding.leaseId)));
    let ownerId: string | null = null;
    for (const [index, lease] of leases.entries()) {
        if ('status' in lease) {
            return lease;
        }
        if (lease.hash !== bindings[index]?.expectedHash) {
            return { status: 'failed' as const, reason: 'lease-hash-mismatch' as const };
        }
        if (ownerId !== null && lease.ownerId !== ownerId) {
            return { status: 'failed' as const, reason: 'lease-owner-mismatch' as const };
        }
        ownerId = lease.ownerId;
    }
    return { status: 'resolved' as const, ownerId: ownerId! };
}

async function resolveRecoveryOwner(recoveryId: string) {
    const database = await records.openDurableAssetDatabase();
    const transaction = database.transaction(PROMOTION_RECOVERY_STORE, 'readonly');
    const completion = records.awaitTransaction(transaction);
    const value = await records.readStoredValue(transaction.objectStore(PROMOTION_RECOVERY_STORE), recoveryId);
    await completion;
    if (value === undefined) {
        return { status: 'missing' as const };
    }
    if (!records.isPromotionRecoveryRecord(value) || value.recoveryId !== recoveryId) {
        return { status: 'failed' as const, reason: 'corrupt-record' as const };
    }
    return { status: 'resolved' as const, ownerId: value.ownerId };
}

export const durableAssetOwnerResolution = {
    binding: resolveBindingOwner,
    recovery: resolveRecoveryOwner,
} as const;
