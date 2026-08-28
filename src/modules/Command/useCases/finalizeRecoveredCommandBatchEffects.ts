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
type FinalizeFailure = {
    status: 'failed';
    disposition: 'manual-repair' | 'retryable';
    reason: string;
};
type FinalizeResult = { status: 'finalized' | 'already-finalized'; receipt: VerifiedBatchReceipt } | FinalizeFailure;

const PROJECT_RECEIPT_REVISION_WARNING =
    'Resulting project heads are omitted because the verified receipt is itself journaled in project truth.';

function sameReceipt(left: VerifiedBatchReceipt, right: VerifiedBatchReceipt): boolean {
    return JSON.stringify(left) === JSON.stringify(right);
}

function getFinalizationAdmissionFailure(input: {
    expectedProjectRevision: string;
    validateRecoveredEffects?: () => string | null;
}): FinalizeFailure | null {
    if (!commandBatchExecutionAuthorityPort.canExecute()) {
        return {
            status: 'failed',
            disposition: 'retryable',
            reason: 'Only the authoritative collaboration host can finalize recovery',
        };
    }
    try {
        if (commandProjectRevisionPort.capture() !== input.expectedProjectRevision) {
            return {
                status: 'failed',
                disposition: 'manual-repair',
                reason: 'The project changed before external-effect finalization',
            };
        }
        const reason = input.validateRecoveredEffects?.() ?? null;
        return reason ? { status: 'failed', disposition: 'retryable', reason } : null;
    } catch (error) {
        return {
            status: 'failed',
            disposition: 'retryable',
            reason: `The current project revision could not be verified: ${error instanceof Error ? error.message : String(error)}`,
        };
    }
}

function getAlreadyFinalizedAdmissionFailure(input: {
    validateRecoveredEffects?: () => string | null;
}): FinalizeFailure | null {
    if (!commandBatchExecutionAuthorityPort.canExecute()) {
        return {
            status: 'failed',
            disposition: 'retryable',
            reason: 'Only the authoritative collaboration host can finalize recovery',
        };
    }
    try {
        const reason = input.validateRecoveredEffects?.() ?? null;
        return reason ? { status: 'failed', disposition: 'retryable', reason } : null;
    } catch (error) {
        return {
            status: 'failed',
            disposition: 'retryable',
            reason: `The retained external-effect proof could not be verified: ${error instanceof Error ? error.message : String(error)}`,
        };
    }
}

export async function finalizeRecoveredCommandBatchEffects(input: {
    authority: CommandBatchAuthority;
    serialized: string;
    pendingReceipt: VerifiedBatchReceipt;
    expectedProjectRevision: string;
    /** Caller-owned proof that its retained external effects still match the pending receipt. */
    validateRecoveredEffects?: () => string | null;
}): Promise<FinalizeResult> {
    if (!commandBatchIdempotencyPort.isConfigured() || !commandProjectRevisionPort.isConfigured()) {
        return {
            status: 'failed',
            disposition: 'retryable',
            reason: 'Durable command recovery authority is unavailable',
        };
    }
    if (!commandBatchExecutionAuthorityPort.canExecute()) {
        return {
            status: 'failed',
            disposition: 'retryable',
            reason: 'Only the authoritative collaboration host can finalize recovery',
        };
    }
    const parsed = parseVersionedCommandBatchEnvelope(input.serialized, input.authority);
    if (parsed.status === 'invalid') {
        return { status: 'failed', disposition: 'manual-repair', reason: parsed.reason };
    }
    const contentHash = await getCommandBatchContentHash(parsed.envelope);
    const lease = {
        projectId: parsed.envelope.projectId,
        idempotencyKey: parsed.envelope.idempotencyKey,
        contentHash,
    };
    if ((await commandBatchIdempotencyPort.tryAcquireRecoveryLease(lease)) !== true) {
        return {
            status: 'failed',
            disposition: 'retryable',
            reason: 'Command batch external-effect recovery is already in progress',
        };
    }
    try {
        const checkpoint = getProjectCommandBatchIdempotencyCheckpoint(lease);
        if (checkpoint.status !== 'pending' && checkpoint.status !== 'complete') {
            return {
                status: 'failed',
                disposition: 'manual-repair',
                reason: 'The durable project checkpoint is unavailable for finalization',
            };
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
            return {
                status: 'failed',
                disposition: 'manual-repair',
                reason: 'Stored project idempotency receipt is invalid',
            };
        }
        if (checkpoint.status === 'complete') {
            if (receipt.pendingEffects.length > 0) {
                return {
                    status: 'failed',
                    disposition: 'manual-repair',
                    reason: 'Completed project checkpoint still contains pending effects',
                };
            }
            const admissionFailure = getAlreadyFinalizedAdmissionFailure(input);
            if (admissionFailure) {
                return admissionFailure;
            }
            return { status: 'already-finalized', receipt };
        }
        if (!sameReceipt(receipt, input.pendingReceipt) || receipt.pendingEffects.length === 0) {
            return {
                status: 'failed',
                disposition: 'manual-repair',
                reason: 'The pending project checkpoint changed before finalization',
            };
        }
        let currentProjectRevision: string;
        try {
            currentProjectRevision = commandProjectRevisionPort.capture();
        } catch (error) {
            return {
                status: 'failed',
                disposition: 'retryable',
                reason: `The current project revision could not be verified: ${error instanceof Error ? error.message : String(error)}`,
            };
        }
        if (!commandBatchExecutionAuthorityPort.canExecute()) {
            return {
                status: 'failed',
                disposition: 'retryable',
                reason: 'Only the authoritative collaboration host can finalize recovery',
            };
        }
        if (currentProjectRevision !== input.expectedProjectRevision) {
            return {
                status: 'failed',
                disposition: 'manual-repair',
                reason: 'The project changed before external-effect finalization',
            };
        }
        const recoveredReceipt = createRecoveredVerifiedBatchReceipt({
            contentHash,
            envelope: parsed.envelope,
            priorReceipt: receipt,
            receiptWarnings: [PROJECT_RECEIPT_REVISION_WARNING],
        });
        const serializedReceipt = JSON.stringify(recoveredReceipt);
        let finalizationAdmissionFailure: FinalizeFailure | null = null;
        try {
            persistProjectCommandBatchIdempotencyCheckpoint({
                ...lease,
                state: 'complete',
                serializedReceipt,
                validateCommit: () => {
                    finalizationAdmissionFailure = getFinalizationAdmissionFailure(input);
                    return finalizationAdmissionFailure?.reason ?? null;
                },
            });
        } catch (error) {
            return (
                finalizationAdmissionFailure ?? {
                    status: 'failed',
                    disposition: 'retryable',
                    reason: error instanceof Error ? error.message : String(error),
                }
            );
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
