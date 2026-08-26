import { isAutomergeStorageMutationOwned } from '#/infra/store/storage/createAutomergeStorage';

import { commandBatchIdempotencyPort } from './commandBatchIdempotencyPort';
import { getProjectCommandBatchIdempotencyCheckpoint } from './getProjectCommandBatchIdempotencyCheckpoint';
import { parseStoredVerifiedBatchReceipt } from './parseStoredVerifiedBatchReceipt';

type VersionedCommandBatchCommitProof = Readonly<{
    projectId: string;
    idempotencyKey: string;
    contentHash: string;
    runId: string;
    batchId: string;
    baseRevision: string;
    commands: ReadonlyArray<{ commandId: string; operation: string }>;
}>;
type CommitDisposition = 'committed' | 'terminal-noncommit' | 'unknown';

function getReceiptDisposition(serializedReceipt: string, proof: VersionedCommandBatchCommitProof): CommitDisposition {
    const receipt = parseStoredVerifiedBatchReceipt({
        baseRevision: proof.baseRevision,
        batchId: proof.batchId,
        commands: proof.commands,
        contentHash: proof.contentHash,
        runId: proof.runId,
        serializedReceipt,
    });
    if (
        receipt?.outcome === 'committed' ||
        receipt?.outcome === 'committed-with-warning' ||
        receipt?.outcome === 'partially-committed'
    ) {
        return 'committed';
    }
    if (
        receipt?.outcome === 'no-op' ||
        receipt?.outcome === 'rejected' ||
        receipt?.outcome === 'conflicted' ||
        receipt?.outcome === 'cancelled' ||
        receipt?.outcome === 'failed' ||
        receipt?.outcome === 'verification-failed'
    ) {
        return 'terminal-noncommit';
    }
    return 'unknown';
}

export async function getVersionedCommandBatchCommitDisposition(
    proof: VersionedCommandBatchCommitProof
): Promise<CommitDisposition> {
    const projectCheckpoint = getProjectCommandBatchIdempotencyCheckpoint(proof);
    if (projectCheckpoint.status === 'complete') {
        return getReceiptDisposition(projectCheckpoint.serializedReceipt, proof) === 'committed'
            ? 'committed'
            : 'unknown';
    }
    if (projectCheckpoint.status === 'pending') {
        if (isAutomergeStorageMutationOwned()) {
            return 'unknown';
        }
        return getReceiptDisposition(projectCheckpoint.serializedReceipt, proof) === 'committed'
            ? 'committed'
            : 'unknown';
    }
    if (projectCheckpoint.status !== 'missing') {
        return 'unknown';
    }
    if (!commandBatchIdempotencyPort.isConfigured()) {
        return 'unknown';
    }
    try {
        const repositoryReceipt = await commandBatchIdempotencyPort.lookup(proof);
        return repositoryReceipt?.status === 'complete'
            ? getReceiptDisposition(repositoryReceipt.serializedReceipt, proof)
            : 'unknown';
    } catch {
        return 'unknown';
    }
}
