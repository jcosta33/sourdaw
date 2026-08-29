import { logger } from '#/infra/logger/appLogger';
import { type createVerifiedBatchReceipt, parseVersionedCommandEnvelope } from '#/modules/Command/useCases';
import { captureProjectRevision } from '#/modules/CrdtDocument/useCases';

import { type PendingAppActionConfirmation } from '../../stores/pendingActionConfirmationStore';
import { agentRunLifecycle } from '../agentRunLifecycle';
import { recordAgentRunReceiptSaga } from '../recordAgentRunReceiptSaga';

import { AGENT_RUN_PERSISTENCE_WARNING } from './settleAgentRunWorkLeaseSafely';

export type CommandVerifiedBatchReceipt = ReturnType<typeof createVerifiedBatchReceipt>;
type PendingEffect = CommandVerifiedBatchReceipt['pendingEffects'][number];

export type CommittedEffectFailureResult = {
    status: 'failed';
    durableCommit: true;
    reason: string;
    effects: PendingEffect[];
    continuation: {
        authority: 'authoritative-collaboration-host';
        idempotency: 'project-checkpoint';
        kind: 'reconcile-exact-batch' | 'manual-repair';
    };
};

function updateTrackedAgentRun(confirmation: PendingAppActionConfirmation, update: () => void): string | null {
    if (!agentRunLifecycle.get(confirmation.runId)) {
        return null;
    }
    try {
        update();
        return null;
    } catch (error) {
        logger.error(new Error('Agent run lifecycle update failed', { cause: error }));
        return AGENT_RUN_PERSISTENCE_WARNING;
    }
}

function getApprovalLabelsByCommandId(confirmation: PendingAppActionConfirmation): ReadonlyMap<string, string> {
    const labels = new Map<string, string>();
    for (const [index, serialized] of (confirmation.approvalSnapshot.commandEnvelopes ?? []).entries()) {
        const parsed = parseVersionedCommandEnvelope(serialized);
        const label = confirmation.approvalSnapshot.actionLabels[index];
        if (parsed.status === 'valid' && label !== undefined) {
            labels.set(parsed.envelope.commandId, label);
        }
    }
    return labels;
}

function createCommittedEffectFailureResult(
    receipt: CommandVerifiedBatchReceipt,
    reason = receipt.warnings[0] ?? receipt.modelSummary
): CommittedEffectFailureResult {
    return {
        status: 'failed',
        durableCommit: true,
        reason,
        effects: [...receipt.pendingEffects],
        continuation: {
            authority: 'authoritative-collaboration-host',
            idempotency: 'project-checkpoint',
            kind: receipt.pendingEffects.some(({ remediation }) => remediation === 'manual-repair')
                ? 'manual-repair'
                : 'reconcile-exact-batch',
        },
    };
}

function getVerifiedReceiptIdentity(receipt: CommandVerifiedBatchReceipt): string {
    return `${receipt.schemaVersion}:${receipt.runId}:${receipt.batchId}:${receipt.outcome}`;
}

function recordTrackedAgentRunReceipt(
    confirmation: PendingAppActionConfirmation,
    receipt: CommandVerifiedBatchReceipt,
    input?: { revertGroupId?: string; completesRun?: boolean; committedRevision?: string }
): { warning: string | null; effectsPending: boolean } {
    let effectsPending = false;
    const warning = updateTrackedAgentRun(confirmation, () => {
        const recorded = recordAgentRunReceiptSaga({
            runId: confirmation.runId,
            receipt,
            actions: confirmation.actions,
            ...(confirmation.approvalSnapshot.commandBatch
                ? { commandBatch: confirmation.approvalSnapshot.commandBatch }
                : {}),
            ...(input?.revertGroupId ? { revertGroupId: input.revertGroupId } : {}),
            ...(input?.completesRun !== undefined ? { completesRun: input.completesRun } : {}),
            committedRevision: input?.committedRevision ?? captureProjectRevision(),
        });
        effectsPending = recorded.effectsPending;
    });
    return { warning, effectsPending };
}

export const confirmedBatchOutcomeSupport = {
    createCommittedEffectFailureResult,
    getApprovalLabelsByCommandId,
    getVerifiedReceiptIdentity,
    recordTrackedAgentRunReceipt,
};
