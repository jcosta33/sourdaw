import { commandBatchIdempotencyPort } from './commandBatchIdempotencyPort';
import { getProjectCommandBatchIdempotencyCheckpoint } from './getProjectCommandBatchIdempotencyCheckpoint';

type VersionedCommandBatchCommitProof = {
    projectId: string;
    idempotencyKey: string;
    contentHash: string;
    runId: string;
    batchId: string;
};

type CommitDisposition = 'committed' | 'terminal-noncommit' | 'unknown';

function getReceiptDisposition(serializedReceipt: string, proof: VersionedCommandBatchCommitProof): CommitDisposition {
    try {
        const receipt: unknown = JSON.parse(serializedReceipt);
        if (
            typeof receipt !== 'object' ||
            receipt === null ||
            (receipt as Record<string, unknown>).schemaVersion !== 1 ||
            (receipt as Record<string, unknown>).runId !== proof.runId ||
            (receipt as Record<string, unknown>).batchId !== proof.batchId
        ) {
            return 'unknown';
        }
        const outcome = (receipt as Record<string, unknown>).outcome;
        if (outcome === 'committed' || outcome === 'committed-with-warning') {
            return 'committed';
        }
        if (
            outcome === 'no-op' ||
            outcome === 'rejected' ||
            outcome === 'conflicted' ||
            outcome === 'cancelled' ||
            outcome === 'failed' ||
            outcome === 'verification-failed'
        ) {
            return 'terminal-noncommit';
        }
    } catch {
        return 'unknown';
    }
    return 'unknown';
}

export async function getVersionedCommandBatchCommitDisposition(
    proof: VersionedCommandBatchCommitProof
): Promise<CommitDisposition> {
    const projectCheckpoint = getProjectCommandBatchIdempotencyCheckpoint(proof);
    if (projectCheckpoint.status === 'pending' || projectCheckpoint.status === 'complete') {
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
