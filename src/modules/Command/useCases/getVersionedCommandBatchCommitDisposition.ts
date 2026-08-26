import { commandBatchIdempotencyPort } from './commandBatchIdempotencyPort';
import { getProjectCommandBatchIdempotencyCheckpoint } from './getProjectCommandBatchIdempotencyCheckpoint';
import { type getVersionedCommandBatchCommitProof } from './getVersionedCommandBatchCommitProof';
import { parseStoredVerifiedBatchReceipt } from './parseStoredVerifiedBatchReceipt';

type VersionedCommandBatchCommitProof = Awaited<ReturnType<typeof getVersionedCommandBatchCommitProof>>;
type CommitDisposition = 'committed' | 'unknown';

function isCommittedReceipt(serializedReceipt: string, proof: VersionedCommandBatchCommitProof): boolean {
    const receipt = parseStoredVerifiedBatchReceipt({
        baseRevision: proof.baseRevision,
        batchId: proof.batchId,
        commands: proof.commands,
        runId: proof.runId,
        serializedReceipt,
    });
    return (
        receipt?.outcome === 'committed' ||
        receipt?.outcome === 'committed-with-warning' ||
        receipt?.outcome === 'partially-committed'
    );
}

export async function getVersionedCommandBatchCommitDisposition(
    proof: VersionedCommandBatchCommitProof
): Promise<CommitDisposition> {
    try {
        const projectCheckpoint = getProjectCommandBatchIdempotencyCheckpoint(proof);
        if (projectCheckpoint.status === 'pending' || projectCheckpoint.status === 'complete') {
            return isCommittedReceipt(projectCheckpoint.serializedReceipt, proof) ? 'committed' : 'unknown';
        }
        if (projectCheckpoint.status !== 'missing' || !commandBatchIdempotencyPort.isConfigured()) {
            return 'unknown';
        }
        const repositoryReceipt = await commandBatchIdempotencyPort.lookup(proof);
        return repositoryReceipt?.status === 'complete' &&
            isCommittedReceipt(repositoryReceipt.serializedReceipt, proof)
            ? 'committed'
            : 'unknown';
    } catch {
        return 'unknown';
    }
}
