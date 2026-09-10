import { logger } from '#/infra/logger/appLogger';
import { type AgentRenderReceipt, type AgentWorkOwnerIdentity } from '#/utils/agentRenderReceipt';

import { type AgentRunArtifact } from '../../models/AgentRun';
import { agentRunLifecycle } from '../agentRunLifecycle';

export const RENDER_RECEIPT_PERSISTENCE_WARNING =
    'Agent run render artifact state could not be persisted. The rendered audio remains authoritative; review durable run artifact state before retrying.';

function ownsReceipt(owner: AgentWorkOwnerIdentity | null, receiptOwner: AgentWorkOwnerIdentity | null): boolean {
    if (!owner || !receiptOwner) {
        return false;
    }
    return (
        receiptOwner.runId === owner.runId &&
        receiptOwner.workId === owner.workId &&
        receiptOwner.leaseId === owner.leaseId &&
        receiptOwner.cancellationGeneration === owner.cancellationGeneration
    );
}

const RENDER_RECEIPT_ARTIFACT_STATUS = {
    started: 'pending',
    rendered: 'completed',
    failed: 'failed',
    cancelled: 'failed',
} as const satisfies Record<string, AgentRunArtifact['status']>;

/**
 * Records a job-level receipt against the run only when it carries this flight's exact lease
 * identity. A receipt from a stale lease describes work this run no longer owns, so attaching it
 * would credit the run with evidence it cannot vouch for. A durable write that fails is reported
 * and dropped: the render itself already succeeded or failed on its own terms, and letting the
 * bookkeeping throw would rewrite that outcome.
 */
export function recordOwnedRenderReceipt(
    runId: string,
    owner: AgentWorkOwnerIdentity | null,
    receipt: AgentRenderReceipt
): void {
    if (receipt.phase === 'batch-settled' || !owner || !ownsReceipt(owner, receipt.owner)) {
        return;
    }
    try {
        agentRunLifecycle.recordArtifact({
            runId,
            kind: 'render',
            artifact: {
                artifactId: receipt.provenance.jobId,
                workId: owner.workId,
                status: RENDER_RECEIPT_ARTIFACT_STATUS[receipt.phase],
                summary: receipt.phase === 'rendered' ? receipt.contentAddress : null,
            },
        });
    } catch (error) {
        logger.warn(RENDER_RECEIPT_PERSISTENCE_WARNING, error);
    }
}
