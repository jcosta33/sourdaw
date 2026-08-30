import { updateChatMessage } from '../../stores/chatStore';
import {
    type PendingAppActionConfirmation,
    updatePendingActionConfirmationStatus,
} from '../../stores/pendingActionConfirmationStore';
import { getVerifiedBatchReplayDisposition } from '../getVerifiedBatchReplayDisposition';
import { recoverPreparedStemImportResources } from '../recoverPreparedStemImportResources';

import { agentRunExecutionSettlement } from './agentRunExecutionSettlement';
import {
    confirmedBatchOutcomeSupport,
    type CommandVerifiedBatchReceipt,
    type CommittedEffectFailureResult,
} from './confirmedBatchOutcomeSupport';
import { pendingActionResourceSettlement } from './pendingActionResourceSettlement';
import {
    AGENT_RUN_STALE_COMPLETION_WARNING,
    type settleAgentRunWorkLeaseSafely,
} from './settleAgentRunWorkLeaseSafely';

type SettleVerifiedBatchReplayInput = {
    confirmation: PendingAppActionConfirmation;
    approvedBatchId: string;
    receipt: CommandVerifiedBatchReceipt;
    recoveredExternalEffects?: boolean;
    leaseSettlement?: ReturnType<typeof settleAgentRunWorkLeaseSafely>;
};

export async function settleVerifiedBatchReplay(
    input: SettleVerifiedBatchReplayInput
): Promise<
    | { status: 'executed' }
    | { status: 'cancelled' }
    | { status: 'failed'; reason: string }
    | CommittedEffectFailureResult
> {
    const {
        confirmation,
        approvedBatchId,
        receipt,
        recoveredExternalEffects = false,
        leaseSettlement = { accepted: true, warning: null },
    } = input;
    if (receipt.outcome === 'partially-committed' && receipt.pendingEffects.length > 0) {
        const receiptPersistenceWarning = confirmedBatchOutcomeSupport.recordTrackedAgentRunReceipt(
            confirmation,
            receipt,
            {
                revertGroupId: approvedBatchId,
                completesRun: false,
            }
        );
        const reason = receipt.warnings[0] ?? receipt.modelSummary;
        const persistenceWarning = receiptPersistenceWarning.warning ?? leaseSettlement.warning;
        await pendingActionResourceSettlement.retainCommitted(confirmation.id);
        updatePendingActionConfirmationStatus({
            confirmationId: confirmation.id,
            status: 'failed',
            error: [reason, persistenceWarning].filter(Boolean).join(' '),
        });
        updateChatMessage(confirmation.assistantMessageId, {
            pendingActionConfirmationStatus: 'failed',
            error: [reason, persistenceWarning].filter(Boolean).join(' '),
            content: `The project change is durably committed, but at least one external effect remains pending: ${reason}. Use the retained reconciliation action on the authoritative collaboration host, or follow the retained manual-repair guidance; the project mutation will not replay.${persistenceWarning ? ` ${persistenceWarning}` : ''}`,
        });
        return confirmedBatchOutcomeSupport.createCommittedEffectFailureResult(receipt, reason);
    }
    const replay = getVerifiedBatchReplayDisposition(receipt);
    if (replay.status === 'committed' || replay.status === 'executed') {
        const receiptPersistenceWarning = confirmedBatchOutcomeSupport.recordTrackedAgentRunReceipt(
            confirmation,
            receipt,
            {
                ...(replay.status === 'committed' ? { revertGroupId: approvedBatchId } : {}),
                completesRun: leaseSettlement.accepted,
            }
        );
        const runPersistenceWarning = receiptPersistenceWarning.warning ?? leaseSettlement.warning;
        await pendingActionResourceSettlement.retainCommitted(confirmation.id);
        updatePendingActionConfirmationStatus({
            confirmationId: confirmation.id,
            status: 'executed',
            error: replay.warning,
        });
        const effect =
            replay.status === 'committed' ? 'project batch was already committed' : 'runtime batch already executed';
        const warning = replay.warning ? ` The prior receipt also reports: ${replay.warning}` : '';
        const persistenceWarning = runPersistenceWarning ? ` ${runPersistenceWarning}` : '';
        const content = recoveredExternalEffects
            ? `This exact ${effect}. Pending external effects were reconciled successfully and the recovered verified receipt was returned.${warning}${persistenceWarning}`
            : `This exact ${effect}. The prior verified receipt was returned without replaying project or runtime effects.${warning}${persistenceWarning}`;
        updateChatMessage(confirmation.assistantMessageId, {
            pendingActionConfirmationStatus: 'executed',
            error: [replay.warning, runPersistenceWarning].filter(Boolean).join(' ') || undefined,
            content: receiptPersistenceWarning.effectsPending
                ? `${content} External render or analysis effects remain pending; this run is not complete.`
                : content,
        });
        return { status: 'executed' };
    }
    if (replay.status === 'no-op') {
        if (!leaseSettlement.accepted) {
            await pendingActionResourceSettlement.settleBestEffort({
                confirmationId: confirmation.id,
                disposition: 'discard',
            });
            const warning = leaseSettlement.warning ?? AGENT_RUN_STALE_COMPLETION_WARNING;
            updatePendingActionConfirmationStatus({
                confirmationId: confirmation.id,
                status: 'cancelled',
                error: warning,
            });
            updateChatMessage(confirmation.assistantMessageId, {
                pendingActionConfirmationStatus: 'cancelled',
                error: warning,
                content: `The prior verified receipt records a no-op. No project or runtime effects were applied, but the run was already cancelled or replaced. ${warning}`,
            });
            return { status: 'cancelled' };
        }
        agentRunExecutionSettlement.completeNoOp(confirmation, receipt.batchId);
        await pendingActionResourceSettlement.settleBestEffort({
            confirmationId: confirmation.id,
            disposition: 'discard',
        });
        updatePendingActionConfirmationStatus({
            confirmationId: confirmation.id,
            status: 'executed',
            ...(leaseSettlement.warning ? { error: leaseSettlement.warning } : {}),
        });
        updateChatMessage(confirmation.assistantMessageId, {
            pendingActionConfirmationStatus: 'executed',
            error: leaseSettlement.warning ?? undefined,
            content: [
                'The prior verified receipt records a no-op. No project or runtime effects were applied.',
                leaseSettlement.warning,
            ]
                .filter(Boolean)
                .join(' '),
        });
        return { status: 'executed' };
    }
    if (replay.status === 'cancelled') {
        agentRunExecutionSettlement.cancelFromVerifiedReceipt(confirmation);
        updatePendingActionConfirmationStatus({
            confirmationId: confirmation.id,
            status: 'cancelled',
            ...(leaseSettlement.warning ? { error: leaseSettlement.warning } : {}),
        });
        updateChatMessage(confirmation.assistantMessageId, {
            pendingActionConfirmationStatus: 'cancelled',
            error: leaseSettlement.warning ?? undefined,
            content: [
                'The prior verified receipt records cancellation before commit. No project changes were applied.',
                leaseSettlement.warning,
            ]
                .filter(Boolean)
                .join(' '),
        });
        await pendingActionResourceSettlement.settleBestEffort({
            confirmationId: confirmation.id,
            disposition: 'discard',
        });
        return { status: 'cancelled' };
    }
    await pendingActionResourceSettlement.settleBestEffort({
        confirmationId: confirmation.id,
        disposition: replay.status === 'ambiguous' ? 'retain' : 'discard',
    });
    if (replay.status === 'ambiguous') {
        await recoverPreparedStemImportResources({ runId: confirmation.runId });
    }
    const userVisibleFailure = [replay.reason, leaseSettlement.warning].filter(Boolean).join(' ');
    updatePendingActionConfirmationStatus({
        confirmationId: confirmation.id,
        status: 'failed',
        error: userVisibleFailure,
    });
    if (leaseSettlement.accepted) {
        agentRunExecutionSettlement.recordFailure(confirmation, {
            category: replay.status === 'ambiguous' ? 'conflict' : 'project',
            retriable: false,
            workId: receipt.batchId,
            receiptIdentity: confirmedBatchOutcomeSupport.getVerifiedReceiptIdentity(receipt),
            ...(replay.status === 'ambiguous' ? { compensation: 'manual-repair' as const } : {}),
        });
    }
    updateChatMessage(confirmation.assistantMessageId, {
        pendingActionConfirmationStatus: 'failed',
        error: userVisibleFailure,
        content:
            replay.status === 'ambiguous'
                ? `The prior verified receipt records an ambiguous outcome: ${replay.reason}. Do not retry it; inspect the project first.${leaseSettlement.warning ? ` ${leaseSettlement.warning}` : ''}`
                : `The prior verified receipt records that this command batch did not apply successfully: ${replay.reason}${leaseSettlement.warning ? ` ${leaseSettlement.warning}` : ''}`,
    });
    return { status: 'failed', reason: replay.reason };
}
