import { getProjectCommandBatchIdempotencyCheckpoint } from './getProjectCommandBatchIdempotencyCheckpoint';

type VersionedCommandBatchCommitProof = {
    projectId: string;
    idempotencyKey: string;
    contentHash: string;
    runId: string;
    batchId: string;
};

export function isVersionedCommandBatchCommitProven(proof: VersionedCommandBatchCommitProof): boolean {
    const checkpoint = getProjectCommandBatchIdempotencyCheckpoint(proof);
    if (checkpoint.status !== 'pending' && checkpoint.status !== 'complete') {
        return false;
    }
    try {
        const receipt: unknown = JSON.parse(checkpoint.serializedReceipt);
        return (
            typeof receipt === 'object' &&
            receipt !== null &&
            (receipt as Record<string, unknown>).runId === proof.runId &&
            (receipt as Record<string, unknown>).batchId === proof.batchId &&
            ((receipt as Record<string, unknown>).outcome === 'committed' ||
                (receipt as Record<string, unknown>).outcome === 'committed-with-warning')
        );
    } catch {
        return false;
    }
}
