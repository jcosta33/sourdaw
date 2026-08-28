import { type CommandBatchAuthority } from '../models/VersionedCommandBatchEnvelope';

import { commandBatchExecutionAuthorityPort } from './commandBatchExecutionAuthorityPort';
import { commandBatchIdempotencyPort } from './commandBatchIdempotencyPort';
import { commandProjectRevisionPort } from './commandProjectRevisionPort';
import { createRecoveredVerifiedBatchReceipt } from './createRecoveredVerifiedBatchReceipt';
import { type createVerifiedBatchReceipt } from './createVerifiedBatchReceipt';
import { getCommandBatchContentHash } from './getCommandBatchContentHash';
import { getProjectCommandBatchIdempotencyCheckpoint } from './getProjectCommandBatchIdempotencyCheckpoint';
import { parseStoredVerifiedBatchReceipt } from './parseStoredVerifiedBatchReceipt';
import { parseVersionedCommandBatchEnvelope } from './parseVersionedCommandBatchEnvelope';
import { persistProjectCommandBatchIdempotencyCheckpoint } from './persistProjectCommandBatchIdempotencyCheckpoint';

type VerifiedBatchReceipt = ReturnType<typeof createVerifiedBatchReceipt>;
type FinalizeResult =
    { status: 'finalized' | 'already-finalized'; receipt: VerifiedBatchReceipt } | { status: 'failed'; reason: string };

const PROJECT_RECEIPT_REVISION_WARNING =
    'Resulting project heads are omitted because the verified receipt is itself journaled in project truth.';

function sameReceipt(left: VerifiedBatchReceipt, right: VerifiedBatchReceipt): boolean {
    return JSON.stringify(left) === JSON.stringify(right);
}

function getFinalizationAdmissionFailure(expectedProjectRevision: string): string | null {
    if (!commandBatchExecutionAuthorityPort.canExecute()) {
        return 'Only the authoritative collaboration host can finalize recovery';
    }
    try {
        return commandProjectRevisionPort.capture() === expectedProjectRevision
            ? null
            : 'The project changed before external-effect finalization';
    } catch (error) {
        return `The current project revision could not be verified: ${error instanceof Error ? error.message : String(error)}`;
    }
}

export async function finalizeRecoveredCommandBatchEffects(input: {
    authority: CommandBatchAuthority;
    serialized: string;
    pendingReceipt: VerifiedBatchReceipt;
    expectedProjectRevision: string;
}): Promise<FinalizeResult> {
    if (!commandBatchIdempotencyPort.isConfigured() || !commandProjectRevisionPort.isConfigured()) {
        return { status: 'failed', reason: 'Durable command recovery authority is unavailable' };
    }
    if (!commandBatchExecutionAuthorityPort.canExecute()) {
        return { status: 'failed', reason: 'Only the authoritative collaboration host can finalize recovery' };
    }
    const parsed = parseVersionedCommandBatchEnvelope(input.serialized, input.authority);
    if (parsed.status === 'invalid') {
        return { status: 'failed', reason: parsed.reason };
    }
    const contentHash = await getCommandBatchContentHash(parsed.envelope);
    const lease = {
        projectId: parsed.envelope.projectId,
        idempotencyKey: parsed.envelope.idempotencyKey,
        contentHash,
    };
    if ((await commandBatchIdempotencyPort.tryAcquireRecoveryLease(lease)) !== true) {
        return { status: 'failed', reason: 'Command batch external-effect recovery is already in progress' };
    }
    try {
        const checkpoint = getProjectCommandBatchIdempotencyCheckpoint(lease);
        if (checkpoint.status !== 'pending' && checkpoint.status !== 'complete') {
            return { status: 'failed', reason: 'The durable project checkpoint is unavailable for finalization' };
        }
        const receipt = parseStoredVerifiedBatchReceipt({
            baseRevision: parsed.envelope.baseRevision,
            batchId: parsed.envelope.batchId,
            commands: parsed.envelope.commands,
            contentHash,
            runId: parsed.envelope.runId,
            serializedReceipt: checkpoint.serializedReceipt,
        });
        if (!receipt) {
            return { status: 'failed', reason: 'Stored project idempotency receipt is invalid' };
        }
        if (checkpoint.status === 'complete') {
            return receipt.pendingEffects.length === 0
                ? { status: 'already-finalized', receipt }
                : { status: 'failed', reason: 'Completed project checkpoint still contains pending effects' };
        }
        if (!sameReceipt(receipt, input.pendingReceipt) || receipt.pendingEffects.length === 0) {
            return { status: 'failed', reason: 'The pending project checkpoint changed before finalization' };
        }
        let currentProjectRevision: string;
        try {
            currentProjectRevision = commandProjectRevisionPort.capture();
        } catch (error) {
            return {
                status: 'failed',
                reason: `The current project revision could not be verified: ${error instanceof Error ? error.message : String(error)}`,
            };
        }
        if (
            !commandBatchExecutionAuthorityPort.canExecute() ||
            currentProjectRevision !== input.expectedProjectRevision
        ) {
            return { status: 'failed', reason: 'The project changed before external-effect finalization' };
        }
        const recoveredReceipt = createRecoveredVerifiedBatchReceipt({
            contentHash,
            envelope: parsed.envelope,
            priorReceipt: receipt,
            receiptWarnings: [PROJECT_RECEIPT_REVISION_WARNING],
        });
        const serializedReceipt = JSON.stringify(recoveredReceipt);
        try {
            persistProjectCommandBatchIdempotencyCheckpoint({
                ...lease,
                state: 'complete',
                serializedReceipt,
                validateCommit: () => getFinalizationAdmissionFailure(input.expectedProjectRevision),
            });
        } catch (error) {
            return {
                status: 'failed',
                reason: error instanceof Error ? error.message : String(error),
            };
        }
        try {
            await commandBatchIdempotencyPort.complete({ ...lease, serializedReceipt });
        } catch {
            // Project truth is authoritative; the repository cache heals from it.
        }
        return { status: 'finalized', receipt: recoveredReceipt };
    } finally {
        try {
            await commandBatchIdempotencyPort.release(lease);
        } catch {
            // The durable checkpoint outcome remains authoritative.
        }
    }
}
