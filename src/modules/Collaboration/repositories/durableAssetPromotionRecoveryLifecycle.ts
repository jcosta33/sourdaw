import {
    ASSET_STORE,
    LEASE_STORE,
    PROMOTION_RECOVERY_LEASE_INDEX,
    PROMOTION_RECOVERY_OWNER_INDEX,
    PROMOTION_RECOVERY_SCHEMA_VERSION,
    PROMOTION_RECOVERY_STORE,
    type PromotionRecoveryRecord,
} from './durableAssetIndexedDb';
import { createDurableAssetRecordAccess } from './durableAssetRecordAccess';
import {
    type DurableAssetFailure,
    type DurableAssetCommitProof,
    type PromoteStagedAssetResult,
    type ReleaseStagedAssetsResult,
    type ReopenDurableAssetResult,
    type StagedAssetBinding,
} from './durableAssetRepositoryContract';

const records = createDurableAssetRecordAccess();
type RecoveryDisposition = 'promote' | 'release';

function getRecoveryDisposition(record: PromotionRecoveryRecord): RecoveryDisposition {
    return record.disposition ?? 'promote';
}

function getPromotionState(record: PromotionRecoveryRecord): 'prepared' | 'committed' {
    return record.promotionState ?? 'committed';
}

function normalizeBindings(bindings: readonly StagedAssetBinding[]): StagedAssetBinding[] | DurableAssetFailure {
    if (bindings.length === 0) {
        return { status: 'failed', reason: 'corrupt-record' };
    }
    const byLeaseId = new Map<string, StagedAssetBinding>();
    for (const binding of bindings) {
        if (binding.leaseId.length === 0 || binding.expectedHash.length === 0) {
            return { status: 'failed', reason: 'corrupt-record' };
        }
        const existing = byLeaseId.get(binding.leaseId);
        if (existing && existing.expectedHash !== binding.expectedHash) {
            return { status: 'failed', reason: 'lease-hash-mismatch' };
        }
        byLeaseId.set(binding.leaseId, { ...binding });
    }
    return [...byLeaseId.values()].sort((left, right) => left.leaseId.localeCompare(right.leaseId));
}

function haveSameBindings(left: readonly StagedAssetBinding[], right: readonly StagedAssetBinding[]): boolean {
    const normalizedLeft = normalizeBindings(left);
    const normalizedRight = normalizeBindings(right);
    return (
        !('status' in normalizedLeft) &&
        !('status' in normalizedRight) &&
        normalizedLeft.length === normalizedRight.length &&
        normalizedLeft.every(
            (binding, index) =>
                binding.leaseId === normalizedRight[index]?.leaseId &&
                binding.expectedHash === normalizedRight[index]?.expectedHash
        )
    );
}

function bindingsAreContained(subset: readonly StagedAssetBinding[], superset: readonly StagedAssetBinding[]): boolean {
    return subset.every((binding) =>
        superset.some(
            (candidate) => candidate.leaseId === binding.leaseId && candidate.expectedHash === binding.expectedHash
        )
    );
}

/** Own crash-restart promotion or cleanup of exact durable leases without replaying their caller. */
export function createDurableAssetPromotionRecoveryLifecycle(
    ownerId: string,
    promoteStagedAsset: (leaseId: string, expectedHash: string) => Promise<PromoteStagedAssetResult>,
    reopenDurableAsset: (hash: string) => Promise<ReopenDurableAssetResult>,
    releaseStagedAssets: (
        bindings: readonly StagedAssetBinding[],
        cleanupRecoveryId?: string
    ) => Promise<ReleaseStagedAssetsResult>
) {
    async function readRecovery(recoveryId: string): Promise<PromotionRecoveryRecord | DurableAssetFailure | null> {
        const database = await records.openDurableAssetDatabase();
        const transaction = database.transaction(PROMOTION_RECOVERY_STORE, 'readonly');
        const completion = records.awaitTransaction(transaction);
        const value = await records.readStoredValue(transaction.objectStore(PROMOTION_RECOVERY_STORE), recoveryId);
        await completion;
        if (value === undefined) {
            return null;
        }
        if (!records.isPromotionRecoveryRecord(value) || value.recoveryId !== recoveryId) {
            return { status: 'failed', reason: 'corrupt-record' };
        }
        if (value.ownerId !== ownerId) {
            return { status: 'failed', reason: 'lease-owner-mismatch' };
        }
        return value;
    }

    async function deleteRecovery(recoveryId: string): Promise<DurableAssetFailure | null> {
        const database = await records.openDurableAssetDatabase();
        const transaction = database.transaction(PROMOTION_RECOVERY_STORE, 'readwrite');
        const completion = records.awaitTransaction(transaction);
        const store = transaction.objectStore(PROMOTION_RECOVERY_STORE);
        const value = await records.readStoredValue(store, recoveryId);
        if (value !== undefined && (!records.isPromotionRecoveryRecord(value) || value.ownerId !== ownerId)) {
            transaction.abort();
            await completion.catch(() => undefined);
            return { status: 'failed', reason: 'corrupt-record' };
        }
        store.delete(recoveryId);
        await completion;
        return null;
    }

    async function completeRecord(record: PromotionRecoveryRecord) {
        if (getRecoveryDisposition(record) === 'release') {
            const released = await releaseStagedAssets(record.bindings, record.recoveryId);
            if (released.status === 'failed') {
                return released;
            }
            return {
                status: 'completed' as const,
                disposition: 'release' as const,
                recoveryId: record.recoveryId,
                releasedHashes: [...new Set(released.releases.map((release) => release.hash))],
            };
        }
        const promotedHashes = new Set<string>();
        for (const binding of record.bindings) {
            const promoted = await promoteStagedAsset(binding.leaseId, binding.expectedHash);
            if (promoted.status === 'failed') {
                if (promoted.reason !== 'unknown-lease') {
                    return promoted;
                }
                const reopened = await reopenDurableAsset(binding.expectedHash);
                if (reopened.status === 'failed') {
                    return promoted;
                }
            }
            promotedHashes.add(binding.expectedHash);
        }
        const deletionFailure = await deleteRecovery(record.recoveryId);
        if (deletionFailure) {
            return deletionFailure;
        }
        return {
            status: 'completed' as const,
            disposition: 'promote' as const,
            recoveryId: record.recoveryId,
            promotedHashes: [...promotedHashes],
        };
    }

    async function prepareRecovery(
        recoveryId: string,
        bindings: readonly StagedAssetBinding[],
        disposition: RecoveryDisposition,
        allowPromotionToCleanup = false,
        commitProof?: DurableAssetCommitProof
    ) {
        if (recoveryId.length === 0) {
            throw new Error('Durable asset recovery identity is required');
        }
        const normalized = normalizeBindings(bindings);
        if ('status' in normalized) {
            return normalized;
        }
        const database = await records.openDurableAssetDatabase();
        const transaction = database.transaction([ASSET_STORE, LEASE_STORE, PROMOTION_RECOVERY_STORE], 'readwrite');
        const completion = records.awaitTransaction(transaction);
        const assetStore = transaction.objectStore(ASSET_STORE);
        const leaseStore = transaction.objectStore(LEASE_STORE);
        const recoveryStore = transaction.objectStore(PROMOTION_RECOVERY_STORE);
        const values = await Promise.all([
            records.readStoredValue(recoveryStore, recoveryId),
            ...normalized.map((binding) => records.readStoredValue(leaseStore, binding.leaseId)),
            ...normalized.map((binding) => records.readStoredValue(assetStore, binding.expectedHash)),
            ...normalized.map((binding) =>
                records.readIndexedValues(recoveryStore, PROMOTION_RECOVERY_LEASE_INDEX, binding.leaseId)
            ),
        ]);
        const existing = values[0];
        const leaseValues = values.slice(1, normalized.length + 1);
        const assetValues = values.slice(normalized.length + 1, normalized.length * 2 + 1);
        const indexedRecoveryValues = values.slice(normalized.length * 2 + 1);
        const indexedRecoveries = new Map<string, PromotionRecoveryRecord>();
        for (const [index, binding] of normalized.entries()) {
            const leaseValue = leaseValues[index];
            const assetValue = assetValues[index];
            if (!records.isLeaseRecord(leaseValue) || !records.isAssetRecord(assetValue)) {
                return fail('corrupt-record');
            }
            const lease = leaseValue;
            const asset = assetValue;
            if (lease.leaseId !== binding.leaseId || asset.hash !== binding.expectedHash) {
                return fail('corrupt-record');
            }
            if (lease.ownerId !== ownerId) {
                return fail('lease-owner-mismatch');
            }
            if (lease.hash !== binding.expectedHash) {
                return fail('lease-hash-mismatch');
            }
            if (lease.state === 'released') {
                return fail('lease-terminal-conflict');
            }
            const exactBacklink =
                lease.state === 'staged'
                    ? asset.activeLeases.some(
                          (candidate) => candidate.leaseId === binding.leaseId && candidate.ownerId === ownerId
                      )
                    : asset.ownerIds.includes(ownerId) &&
                      !asset.activeLeases.some((candidate) => candidate.leaseId === binding.leaseId);
            if (!exactBacklink) {
                return fail('corrupt-record');
            }
            const recoveriesForLease = indexedRecoveryValues[index];
            if (!Array.isArray(recoveriesForLease)) {
                return fail('corrupt-record');
            }
            for (const recovery of recoveriesForLease) {
                if (
                    !records.isPromotionRecoveryRecord(recovery) ||
                    recovery.ownerId !== ownerId ||
                    !recovery.bindings.some(
                        (candidate) =>
                            candidate.leaseId === binding.leaseId && candidate.expectedHash === binding.expectedHash
                    )
                ) {
                    return fail('corrupt-record');
                }
                indexedRecoveries.set(recovery.recoveryId, recovery);
            }
        }
        if (existing !== undefined && !records.isPromotionRecoveryRecord(existing)) {
            return fail('corrupt-record');
        }
        if (records.isPromotionRecoveryRecord(existing)) {
            indexedRecoveries.set(existing.recoveryId, existing);
        }
        let promotionState: 'prepared' | 'committed' = 'prepared';
        for (const recovery of indexedRecoveries.values()) {
            const sameClaim =
                recovery.recoveryId === recoveryId &&
                recovery.ownerId === ownerId &&
                getRecoveryDisposition(recovery) === disposition &&
                haveSameBindings(recovery.bindings, normalized);
            if (sameClaim) {
                if (disposition === 'promote' && getPromotionState(recovery) === 'committed') {
                    promotionState = 'committed';
                }
                continue;
            }
            const replaceCleanupWithPromotion =
                disposition === 'promote' &&
                getRecoveryDisposition(recovery) === 'release' &&
                recovery.ownerId === ownerId &&
                (haveSameBindings(recovery.bindings, normalized) ||
                    (recovery.recoveryKind === 'default-release' &&
                        bindingsAreContained(recovery.bindings, normalized)));
            const replaceDefaultCleanup =
                disposition === 'release' &&
                recovery.recoveryKind === 'default-release' &&
                recovery.ownerId === ownerId &&
                bindingsAreContained(recovery.bindings, normalized);
            const replacePromotionWithCleanup =
                allowPromotionToCleanup &&
                disposition === 'release' &&
                recovery.recoveryId === recoveryId &&
                getRecoveryDisposition(recovery) === 'promote' &&
                getPromotionState(recovery) === 'prepared' &&
                recovery.ownerId === ownerId &&
                haveSameBindings(recovery.bindings, normalized);
            if (!replaceCleanupWithPromotion && !replaceDefaultCleanup && !replacePromotionWithCleanup) {
                return fail('owner-handoff-conflict');
            }
            if (recovery.recoveryId !== recoveryId) {
                recoveryStore.delete(recovery.recoveryId);
            }
        }
        recoveryStore.put({
            schemaVersion: PROMOTION_RECOVERY_SCHEMA_VERSION,
            recoveryId,
            ownerId,
            leaseIds: normalized.map((binding) => binding.leaseId),
            bindings: normalized,
            disposition,
            recoveryKind: 'explicit',
            ...(disposition === 'promote' && commitProof ? { commitProof } : {}),
            ...(disposition === 'promote' ? { promotionState } : {}),
            preparedAt: records.isPromotionRecoveryRecord(existing) ? existing.preparedAt : Date.now(),
        } satisfies PromotionRecoveryRecord);
        await completion;
        return { status: 'prepared' as const, recoveryId, ownerId };

        async function fail(reason: DurableAssetFailure['reason']): Promise<DurableAssetFailure> {
            transaction.abort();
            await completion.catch(() => undefined);
            return { status: 'failed', reason };
        }
    }

    return {
        async preparePromotionRecovery(
            recoveryId: string,
            bindings: readonly StagedAssetBinding[],
            commitProof?: DurableAssetCommitProof
        ) {
            return prepareRecovery(recoveryId, bindings, 'promote', false, commitProof);
        },

        async prepareCleanupRecovery(recoveryId: string, bindings: readonly StagedAssetBinding[]) {
            return prepareRecovery(recoveryId, bindings, 'release');
        },

        async transitionPromotionRecoveryToCleanup(recoveryId: string, bindings: readonly StagedAssetBinding[]) {
            return prepareRecovery(recoveryId, bindings, 'release', true);
        },

        async commitPromotionRecovery(recoveryId: string) {
            const database = await records.openDurableAssetDatabase();
            const transaction = database.transaction(PROMOTION_RECOVERY_STORE, 'readwrite');
            const completion = records.awaitTransaction(transaction);
            const store = transaction.objectStore(PROMOTION_RECOVERY_STORE);
            const value = await records.readStoredValue(store, recoveryId);
            if (value === undefined) {
                await completion;
                return { status: 'missing' as const, recoveryId };
            }
            if (
                !records.isPromotionRecoveryRecord(value) ||
                value.ownerId !== ownerId ||
                getRecoveryDisposition(value) !== 'promote'
            ) {
                transaction.abort();
                await completion.catch(() => undefined);
                return { status: 'failed' as const, reason: 'corrupt-record' as const };
            }
            store.put({ ...value, promotionState: 'committed' } satisfies PromotionRecoveryRecord);
            await completion;
            return { status: 'committed' as const, recoveryId };
        },

        async completePromotionRecovery(recoveryId: string) {
            const recovery = await readRecovery(recoveryId);
            if (recovery === null) {
                return { status: 'missing' as const, recoveryId, promotedHashes: [] };
            }
            if ('status' in recovery) {
                return recovery;
            }
            if (getRecoveryDisposition(recovery) !== 'promote') {
                return { status: 'failed' as const, reason: 'owner-handoff-conflict' as const };
            }
            if (getPromotionState(recovery) !== 'committed') {
                return { status: 'failed' as const, reason: 'lease-terminal-conflict' as const };
            }
            const completed = await completeRecord(recovery);
            if (completed.status === 'failed') {
                return completed;
            }
            if (completed.disposition !== 'promote') {
                return { status: 'failed' as const, reason: 'corrupt-record' as const };
            }
            return { status: 'completed' as const, recoveryId, promotedHashes: completed.promotedHashes };
        },

        async completeCleanupRecovery(recoveryId: string) {
            const recovery = await readRecovery(recoveryId);
            if (recovery === null) {
                return { status: 'missing' as const, recoveryId, releasedHashes: [] };
            }
            if ('status' in recovery) {
                return recovery;
            }
            if (getRecoveryDisposition(recovery) !== 'release') {
                return { status: 'failed' as const, reason: 'owner-handoff-conflict' as const };
            }
            const completed = await completeRecord(recovery);
            if (completed.status === 'failed') {
                return completed;
            }
            if (completed.disposition !== 'release') {
                return { status: 'failed' as const, reason: 'corrupt-record' as const };
            }
            return { status: 'completed' as const, recoveryId, releasedHashes: completed.releasedHashes };
        },

        async cancelPromotionRecovery(recoveryId: string) {
            const recovery = await readRecovery(recoveryId);
            if (recovery === null) {
                return { status: 'missing' as const, recoveryId };
            }
            if ('status' in recovery) {
                return recovery;
            }
            if (getRecoveryDisposition(recovery) !== 'promote') {
                return { status: 'failed' as const, reason: 'owner-handoff-conflict' as const };
            }
            if (getPromotionState(recovery) === 'committed') {
                return { status: 'failed' as const, reason: 'lease-terminal-conflict' as const };
            }
            const deletionFailure = await deleteRecovery(recoveryId);
            return deletionFailure ?? { status: 'cancelled' as const, recoveryId };
        },

        async resumeRecoveries(
            protectedRecoveryIds: ReadonlySet<string> = new Set(),
            isCommitProven: (proof: DurableAssetCommitProof) => boolean = () => false,
            protectDefaultReleaseClaims = false
        ) {
            const database = await records.openDurableAssetDatabase();
            const transaction = database.transaction(PROMOTION_RECOVERY_STORE, 'readonly');
            const completion = records.awaitTransaction(transaction);
            const values = await records.readIndexedValues(
                transaction.objectStore(PROMOTION_RECOVERY_STORE),
                PROMOTION_RECOVERY_OWNER_INDEX,
                ownerId
            );
            await completion;
            if (values.some((value) => !records.isPromotionRecoveryRecord(value))) {
                return { status: 'failed' as const, reason: 'corrupt-record' as const };
            }
            const promotedHashes = new Set<string>();
            for (const recovery of values as PromotionRecoveryRecord[]) {
                if (protectedRecoveryIds.has(recovery.recoveryId)) {
                    continue;
                }
                if (protectDefaultReleaseClaims && recovery.recoveryKind === 'default-release') {
                    continue;
                }
                if (getRecoveryDisposition(recovery) === 'promote' && getPromotionState(recovery) !== 'committed') {
                    if (!recovery.commitProof || !isCommitProven(recovery.commitProof)) {
                        continue;
                    }
                }
                const completed = await completeRecord(recovery);
                if (completed.status === 'failed') {
                    return completed;
                }
                if (completed.disposition === 'promote') {
                    for (const hash of completed.promotedHashes) {
                        promotedHashes.add(hash);
                    }
                }
            }
            return {
                status: 'resumed' as const,
                ownerId,
                recoveryCount: values.length,
                promotedHashes: [...promotedHashes],
            };
        },
    };
}
