import {
    getVersionedCommandBatchIdempotentReplay,
    refreshVersionedCommandBatchForApproval,
} from '#/modules/Command/useCases';
import { projectRevisionMatchesLiveIgnoringCommandCheckpoint } from '#/modules/CrdtDocument/useCases';

import { type ChatActionConfirmationStatus } from '../../models/Chat';
import { chatStore, updateChatMessage } from '../../stores/chatStore';
import {
    getPendingActionConfirmation,
    refreshPendingActionConfirmationApproval,
    type PendingAppActionConfirmation,
    updatePendingActionFollowUp,
} from '../../stores/pendingActionConfirmationStore';
import { hasExactAgentCommandBatchAuthority } from '../../validators/hasExactAgentCommandBatchAuthority';
import { compileAgentRiskApproval } from '../compileAgentRiskApproval';

import { admitCommittedSectionRenderRetry } from './admitCommittedSectionRenderRetry';
import { confirmationTerminalSettlement } from './confirmationTerminalSettlement';
import { type CommandVerifiedBatchReceipt } from './confirmedBatchOutcomeSupport';

type ApprovalDivergence = Extract<
    ReturnType<typeof refreshVersionedCommandBatchForApproval>,
    { status: 'ready' | 'conflicted' }
>['divergence'];

type TerminalConfirmationResult = ReturnType<typeof confirmationTerminalSettlement.failSectionRenderRetryProof>;

type HandledConfirmationAdmission = {
    status: 'handled';
    result:
        | TerminalConfirmationResult
        | { status: 'missing' }
        | { status: 'not_pending'; currentStatus: ChatActionConfirmationStatus }
        | { status: 'busy' }
        | { status: 'reapproval_required'; divergence: ApprovalDivergence };
};

type ResolveConfirmationAdmissionResult =
    | HandledConfirmationAdmission
    | {
          status: 'render-retry';
          confirmation: PendingAppActionConfirmation;
          durableReceipt: CommandVerifiedBatchReceipt;
          commandBatch: NonNullable<PendingAppActionConfirmation['approvalSnapshot']['commandBatch']>;
      }
    | {
          status: 'ready';
          confirmation: PendingAppActionConfirmation;
          priorVerifiedBatchReceipt: CommandVerifiedBatchReceipt | null;
          recoveringPendingEffects: boolean;
      };

function hasSameAdmissionBinding(
    current: PendingAppActionConfirmation,
    admitted: PendingAppActionConfirmation
): boolean {
    const currentBatch = current.approvalSnapshot.commandBatch;
    const admittedBatch = admitted.approvalSnapshot.commandBatch;
    return (
        current.id === admitted.id &&
        current.runId === admitted.runId &&
        current.status === admitted.status &&
        current.projectRevision === admitted.projectRevision &&
        currentBatch?.serialized === admittedBatch?.serialized &&
        (currentBatch === undefined ||
            admittedBatch === undefined ||
            hasExactAgentCommandBatchAuthority(currentBatch.authority, admittedBatch.authority))
    );
}

function getRetainedRenderCapacityFailure(
    confirmation: PendingAppActionConfirmation
): TerminalConfirmationResult | null {
    if (
        confirmation.status !== 'executed' ||
        confirmation.followUpStatus !== 'failed' ||
        !confirmation.error?.includes('retention capacity')
    ) {
        return null;
    }
    const reason = confirmation.error;
    updatePendingActionFollowUp({
        confirmationId: confirmation.id,
        error: 'Section render manual repair is already required.',
        status: 'failed',
    });
    return { status: 'failed', reason };
}

function consumeConfirmationAdmission(
    admission: ResolveConfirmationAdmissionResult
): ResolveConfirmationAdmissionResult {
    if (admission.status === 'handled') {
        return admission;
    }
    const current = getPendingActionConfirmation(admission.confirmation.id);
    if (!current) {
        return { status: 'handled', result: { status: 'missing' } };
    }
    if (!hasSameAdmissionBinding(current, admission.confirmation)) {
        return { status: 'handled', result: { status: 'not_pending', currentStatus: current.status } };
    }
    if (admission.status === 'render-retry') {
        const retry = admitCommittedSectionRenderRetry({
            confirmation: current,
            durableReceipt: admission.durableReceipt,
            expectedCommandBatch: admission.commandBatch,
            phase: 'proof',
        });
        if (retry.status === 'admitted') {
            return { ...admission, confirmation: current, durableReceipt: retry.durableReceipt };
        }
        if (retry.status === 'proof-mismatch') {
            return {
                status: 'handled',
                result: confirmationTerminalSettlement.failSectionRenderRetryProof(current),
            };
        }
        return { status: 'handled', result: { status: 'not_pending', currentStatus: current.status } };
    }
    if (chatStore.value?.isGenerating === true) {
        updateChatMessage(current.assistantMessageId, {
            pendingActionConfirmationStatus: 'proposed',
            content: `Another AI command is still running. This proposal remains pending:\n\n${current.actionLabels.map((label) => `- ${label}`).join('\n')}`,
        });
        return { status: 'handled', result: { status: 'busy' } };
    }
    return { ...admission, confirmation: current };
}

async function resolveConfirmationAdmission(input: {
    confirmationId: string;
}): Promise<ResolveConfirmationAdmissionResult> {
    let confirmation = getPendingActionConfirmation(input.confirmationId);
    if (!confirmation) {
        return { status: 'handled', result: { status: 'missing' } };
    }
    const approvedCommandBatch = confirmation.approvalSnapshot.commandBatch;
    const wasProposed = confirmation.status === 'proposed';
    const initialRetryAdmission = admitCommittedSectionRenderRetry({ confirmation, phase: 'eligibility' });
    const wasRetryEligible = initialRetryAdmission.status === 'requires-proof';
    const shouldInspectDurableReceipt = wasProposed || wasRetryEligible;
    let priorVerifiedBatchReceipt: CommandVerifiedBatchReceipt | null = null;
    if (approvedCommandBatch && shouldInspectDurableReceipt) {
        try {
            priorVerifiedBatchReceipt = await getVersionedCommandBatchIdempotentReplay({
                authority: approvedCommandBatch.authority,
                serialized: approvedCommandBatch.serialized,
            });
        } catch (error) {
            const liveConfirmation = getPendingActionConfirmation(input.confirmationId);
            if (!liveConfirmation) {
                return { status: 'handled', result: { status: 'missing' } };
            }
            if (!hasSameAdmissionBinding(liveConfirmation, confirmation)) {
                return {
                    status: 'handled',
                    result: { status: 'not_pending', currentStatus: liveConfirmation.status },
                };
            }
            if (wasRetryEligible) {
                const liveRetryAdmission = admitCommittedSectionRenderRetry({
                    confirmation: liveConfirmation,
                    expectedCommandBatch: approvedCommandBatch,
                    phase: 'eligibility',
                });
                if (liveRetryAdmission.status !== 'requires-proof') {
                    return {
                        status: 'handled',
                        result: { status: 'not_pending', currentStatus: liveConfirmation.status },
                    };
                }
            }
            return {
                status: 'handled',
                result: confirmationTerminalSettlement.failUnreadableCommitEvidence(
                    liveConfirmation,
                    error,
                    wasRetryEligible
                ),
            };
        }
        const refreshedConfirmation = getPendingActionConfirmation(input.confirmationId);
        if (!refreshedConfirmation) {
            return { status: 'handled', result: { status: 'missing' } };
        }
        const refreshedRetryAdmission = admitCommittedSectionRenderRetry({
            confirmation: refreshedConfirmation,
            expectedCommandBatch: approvedCommandBatch,
            phase: 'eligibility',
        });
        const retryAdmissionChanged = wasRetryEligible && refreshedRetryAdmission.status !== 'requires-proof';
        if (
            refreshedRetryAdmission.status === 'stale' ||
            retryAdmissionChanged ||
            (wasProposed && refreshedConfirmation.status !== 'proposed')
        ) {
            return {
                status: 'handled',
                result: { status: 'not_pending', currentStatus: refreshedConfirmation.status },
            };
        }
        confirmation = refreshedConfirmation;
    }
    if (wasRetryEligible) {
        const retryAdmission = admitCommittedSectionRenderRetry({
            confirmation,
            durableReceipt: priorVerifiedBatchReceipt,
            expectedCommandBatch: approvedCommandBatch,
            phase: 'proof',
        });
        if (retryAdmission.status === 'admitted') {
            const commandBatch = confirmation.approvalSnapshot.commandBatch;
            if (!commandBatch) {
                return {
                    status: 'handled',
                    result: confirmationTerminalSettlement.failSectionRenderRetryProof(confirmation),
                };
            }
            return {
                status: 'render-retry',
                confirmation,
                durableReceipt: retryAdmission.durableReceipt,
                commandBatch,
            };
        }
        if (retryAdmission.status === 'proof-mismatch') {
            return {
                status: 'handled',
                result: confirmationTerminalSettlement.failSectionRenderRetryProof(confirmation),
            };
        }
    }
    const retainedRenderCapacityFailure = getRetainedRenderCapacityFailure(confirmation);
    if (retainedRenderCapacityFailure) {
        return { status: 'handled', result: retainedRenderCapacityFailure };
    }
    if (confirmation.status !== 'proposed') {
        return { status: 'handled', result: { status: 'not_pending', currentStatus: confirmation.status } };
    }

    const hasPriorVerifiedBatchReceipt = priorVerifiedBatchReceipt !== null;
    const recoveringPendingEffects =
        priorVerifiedBatchReceipt?.outcome === 'partially-committed' &&
        priorVerifiedBatchReceipt.pendingEffects.length > 0;
    if (
        !hasPriorVerifiedBatchReceipt &&
        !projectRevisionMatchesLiveIgnoringCommandCheckpoint(confirmation.projectRevision)
    ) {
        const commandBatch = confirmation.approvalSnapshot.commandBatch;
        if (!commandBatch) {
            return {
                status: 'handled',
                result: await confirmationTerminalSettlement.invalidateForProjectChange(confirmation),
            };
        }
        const refreshed = refreshVersionedCommandBatchForApproval({
            authority: commandBatch.authority,
            serialized: commandBatch.serialized,
        });
        if (refreshed.status !== 'ready') {
            if (refreshed.status === 'conflicted') {
                return {
                    status: 'handled',
                    result: await confirmationTerminalSettlement.invalidateForDivergence(
                        confirmation,
                        refreshed.divergence
                    ),
                };
            }
            return {
                status: 'handled',
                result: await confirmationTerminalSettlement.invalidateForProjectChange(confirmation),
            };
        }
        const agentApproval = compileAgentRiskApproval({ commandBatch: refreshed.commandBatch });
        const rebound = refreshPendingActionConfirmationApproval({
            agentApproval,
            commandBatch: refreshed.commandBatch,
            commandEnvelopes: refreshed.commandEnvelopes,
            confirmationId: confirmation.id,
            projectRevision: refreshed.currentRevision,
        });
        if (!rebound) {
            return {
                status: 'handled',
                result: await confirmationTerminalSettlement.invalidateForProjectChange(confirmation),
            };
        }
        updateChatMessage(confirmation.assistantMessageId, {
            pendingActionConfirmationStatus: 'proposed',
            content: `The project changed after the prior approval. Divergence was classified as ${refreshed.divergence.kind}; the unchanged command plan was revalidated and rebound to the current project revision. Review and confirm again:\n\n${rebound.actionLabels.map((label) => `- ${label}`).join('\n')}`,
        });
        return { status: 'handled', result: { status: 'reapproval_required', divergence: refreshed.divergence } };
    }
    if (chatStore.value?.isGenerating === true) {
        updateChatMessage(confirmation.assistantMessageId, {
            pendingActionConfirmationStatus: 'proposed',
            content: `Another AI command is still running. This proposal remains pending:\n\n${confirmation.actionLabels.map((label) => `- ${label}`).join('\n')}`,
        });
        return { status: 'handled', result: { status: 'busy' } };
    }
    return { status: 'ready', confirmation, priorVerifiedBatchReceipt, recoveringPendingEffects };
}

export const confirmationAdmission = { consumeConfirmationAdmission, resolveConfirmationAdmission };
