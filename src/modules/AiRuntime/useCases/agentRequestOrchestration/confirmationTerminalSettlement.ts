import { type refreshVersionedCommandBatchForApproval } from '#/modules/Command/useCases';

import { AiProposalInvalidatedError } from '../../errors/AiProposalInvalidatedError';
import { type AgentRunErrorCategory } from '../../models/AgentRun';
import { updateChatMessage } from '../../stores/chatStore';
import {
    type PendingAppActionConfirmation,
    updatePendingActionConfirmationStatus,
    updatePendingActionFollowUp,
} from '../../stores/pendingActionConfirmationStore';
import { agentRunCancellation } from '../cancelAgentRun';

import { agentRunExecutionSettlement } from './agentRunExecutionSettlement';
import { pendingActionResourceSettlement } from './pendingActionResourceSettlement';

type ApprovalDivergence = Extract<
    ReturnType<typeof refreshVersionedCommandBatchForApproval>,
    { status: 'ready' | 'conflicted' }
>['divergence'];

type TerminalConfirmationResult =
    | { status: 'failed'; reason: string }
    | { status: 'invalidated'; reason: string; divergence?: ApprovalDivergence }
    | { status: 'cancelled' };

const RENDER_RETRY_PROOF_MISMATCH_REASON =
    'The retained render retry proof no longer matches the committed project batch.';

function failSectionRenderRetryProof(confirmation: PendingAppActionConfirmation): TerminalConfirmationResult {
    updatePendingActionFollowUp({
        confirmationId: confirmation.id,
        error: RENDER_RETRY_PROOF_MISMATCH_REASON,
        status: 'failed',
    });
    updatePendingActionConfirmationStatus({
        confirmationId: confirmation.id,
        status: 'failed',
        error: RENDER_RETRY_PROOF_MISMATCH_REASON,
    });
    updateChatMessage(confirmation.assistantMessageId, {
        pendingActionConfirmationStatus: 'failed',
        pendingActionFollowUpStatus: 'failed',
        error: RENDER_RETRY_PROOF_MISMATCH_REASON,
        content:
            'The missing section renders were not retried because the retained proof no longer matches the approved batch and recorded commit evidence. Project actions were not replayed. Verify the project state before taking further action.',
    });
    return { status: 'failed', reason: RENDER_RETRY_PROOF_MISMATCH_REASON };
}

function failUnreadableCommitEvidence(
    confirmation: PendingAppActionConfirmation,
    error: unknown,
    retryRemainsAvailable: boolean
): TerminalConfirmationResult {
    const detail = error instanceof Error ? error.message : String(error);
    const reason = retryRemainsAvailable
        ? `The durable commit evidence for the retained render retry could not be read: ${detail}. The render retry remains available.`
        : `The durable commit evidence for the confirmed actions could not be read: ${detail}. The proposal remains pending.`;
    updateChatMessage(confirmation.assistantMessageId, {
        error: reason,
        content: retryRemainsAvailable
            ? `The missing section renders were not retried because the durable commit evidence could not be read: ${detail}. Project actions were not replayed and the render retry remains available.`
            : `The confirmed actions were not executed because the durable commit evidence could not be read: ${detail}. Project actions were not replayed; the proposal remains pending.`,
    });
    return { status: 'failed', reason };
}

async function failApprovalPreflight(
    confirmation: PendingAppActionConfirmation,
    reason: string,
    category: AgentRunErrorCategory
): Promise<TerminalConfirmationResult> {
    agentRunExecutionSettlement.recordFailure(confirmation, {
        category,
        retriable: true,
    });
    updatePendingActionConfirmationStatus({
        confirmationId: confirmation.id,
        status: 'failed',
        error: reason,
    });
    updateChatMessage(confirmation.assistantMessageId, {
        pendingActionConfirmationStatus: 'failed',
        error: reason,
        content: `The confirmed command was rejected before execution: ${reason}`,
    });
    await pendingActionResourceSettlement.settleBestEffort({ confirmationId: confirmation.id, disposition: 'discard' });
    return { status: 'failed', reason };
}

async function invalidateForProjectChange(
    confirmation: PendingAppActionConfirmation
): Promise<TerminalConfirmationResult> {
    const reason = new AiProposalInvalidatedError().message;
    await agentRunCancellation.cancel({ runId: confirmation.runId, reason });
    updatePendingActionConfirmationStatus({
        confirmationId: confirmation.id,
        status: 'invalidated',
        error: reason,
    });
    updateChatMessage(confirmation.assistantMessageId, {
        pendingActionConfirmationStatus: 'invalidated',
        error: reason,
        content:
            'This proposal was not executed because the project changed after it was created. Review the current project and submit the command again.',
    });
    await pendingActionResourceSettlement.settleBestEffort({ confirmationId: confirmation.id, disposition: 'discard' });
    return { status: 'invalidated', reason };
}

async function invalidateForDivergence(
    confirmation: PendingAppActionConfirmation,
    divergence: ApprovalDivergence
): Promise<TerminalConfirmationResult> {
    const targetIds = divergence.targetIds.length > 0 ? divergence.targetIds.join(', ') : 'none';
    const candidates = divergence.repairCandidates
        .map((candidate) => `${candidate.kind}: ${candidate.targetIds.join(', ') || 'project'}`)
        .join('; ');
    const reason = `The approved command was not executed because project divergence is ${divergence.kind}.`;
    await agentRunCancellation.cancel({ runId: confirmation.runId, reason });
    updatePendingActionConfirmationStatus({
        confirmationId: confirmation.id,
        status: 'invalidated',
        error: reason,
    });
    updateChatMessage(confirmation.assistantMessageId, {
        pendingActionConfirmationStatus: 'invalidated',
        error: reason,
        content: `${reason} Affected targets: ${targetIds}.${candidates ? ` Repair candidates: ${candidates}.` : ''} Review the current project before planning again.`,
    });
    await pendingActionResourceSettlement.settleBestEffort({ confirmationId: confirmation.id, disposition: 'discard' });
    return { status: 'invalidated', reason, divergence };
}

async function cancelAcceptedConfirmation(
    confirmation: PendingAppActionConfirmation
): Promise<TerminalConfirmationResult> {
    agentRunExecutionSettlement.cancelBeforeCommit(confirmation);
    updatePendingActionConfirmationStatus({
        confirmationId: confirmation.id,
        status: 'cancelled',
    });
    updateChatMessage(confirmation.assistantMessageId, {
        pendingActionConfirmationStatus: 'cancelled',
        error: undefined,
        content: 'Command cancelled before it committed. No project changes were applied.',
    });
    await pendingActionResourceSettlement.settleBestEffort({ confirmationId: confirmation.id, disposition: 'discard' });
    return { status: 'cancelled' };
}

export const confirmationTerminalSettlement = {
    cancelAcceptedConfirmation,
    failApprovalPreflight,
    failSectionRenderRetryProof,
    failUnreadableCommitEvidence,
    invalidateForDivergence,
    invalidateForProjectChange,
};
