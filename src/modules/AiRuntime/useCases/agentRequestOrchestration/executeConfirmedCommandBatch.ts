import { getAgentSectionRenderArtifacts } from '#/modules/AudioRendering/useCases';
import { collaborationStore } from '#/modules/Collaboration/stores';
import { executeVersionedCommandBatchEnvelope } from '#/modules/Command/useCases';
import { captureProjectMutationAuthorization, captureUnownedProjectMutations } from '#/modules/CrdtDocument/useCases';
import { type HandlerDeferredEffectAttempt } from '#/utils/handlerContract';

import { type AgentRunWorkLease } from '../../models/AgentRun';
import { setActiveAborter, setChatGenerating, updateChatMessage } from '../../stores/chatStore';
import {
    preparePendingActionResourceLeaseForCommit,
    protectPendingActionResourceLease,
    type PendingAppActionConfirmation,
    updatePendingActionConfirmationStatus,
} from '../../stores/pendingActionConfirmationStore';
import { agentRunCancellation } from '../cancelAgentRun';
import { getVerifiedBatchReplayDisposition } from '../getVerifiedBatchReplayDisposition';
import { issueAgentCommandApprovalBinding } from '../issueAgentCommandApprovalBinding';
import { prepareAgentRunPendingEffectContinuation } from '../prepareAgentRunPendingEffectContinuation';

import { agentRunExecutionSettlement } from './agentRunExecutionSettlement';
import {
    confirmedBatchOutcomeSupport,
    type CommandVerifiedBatchReceipt,
    type CommittedEffectFailureResult,
} from './confirmedBatchOutcomeSupport';
import { pendingActionResourceSettlement } from './pendingActionResourceSettlement';

type ExecuteConfirmedCommandBatchInput = {
    confirmation: PendingAppActionConfirmation;
    commandBatch: NonNullable<PendingAppActionConfirmation['approvalSnapshot']['commandBatch']>;
    approvedBatchId: string;
    trackedWorkLease: AgentRunWorkLease | null;
    priorVerifiedBatchReceipt: CommandVerifiedBatchReceipt | null;
    recoveringPendingEffects: boolean;
};

type ExecuteConfirmedCommandBatchResult =
    | {
          status: 'completed';
          batchResult: Exclude<
              Awaited<ReturnType<typeof executeVersionedCommandBatchEnvelope>>,
              { status: 'previewed' }
          >;
          group: { groupId: string; groupLabel: string };
          sectionRenderArtifactsBeforeExecution: ReturnType<typeof getAgentSectionRenderArtifacts>;
          isProjectMutationAuthorized: () => boolean;
          unownedMutationsBeforeBatch: number;
          renderJobAttempts: number;
          cancellationTriggeredByInvalidation: boolean;
          abortSignal: AbortSignal;
      }
    | { status: 'recovery-failed'; result: CommittedEffectFailureResult }
    | { status: 'failed'; error: unknown };

function isConfirmationExecutionAuthorized(isProjectMutationAuthorized: () => boolean, signal: AbortSignal): boolean {
    if (signal.aborted) {
        return false;
    }
    return isProjectMutationAuthorized();
}

function hasCommittedProjectPriorReceipt(
    receipt: CommandVerifiedBatchReceipt | null
): receipt is CommandVerifiedBatchReceipt {
    if (!receipt) {
        return false;
    }
    const disposition = getVerifiedBatchReplayDisposition(receipt);
    return disposition.status === 'committed';
}

export async function executeConfirmedCommandBatch(
    input: ExecuteConfirmedCommandBatchInput
): Promise<ExecuteConfirmedCommandBatchResult> {
    const {
        confirmation,
        commandBatch,
        approvedBatchId,
        trackedWorkLease,
        priorVerifiedBatchReceipt,
        recoveringPendingEffects,
    } = input;
    const hasPriorVerifiedBatchReceipt = priorVerifiedBatchReceipt !== null;
    const group = {
        groupId: approvedBatchId,
        groupLabel: confirmation.groupLabel ?? confirmation.prompt,
    };
    const sectionRenderArtifactsBeforeExecution = getAgentSectionRenderArtifacts();
    const aborter = new AbortController();
    setChatGenerating(true);
    setActiveAborter(aborter);
    const releaseCommandCancellation = trackedWorkLease
        ? agentRunCancellation.bindAbortController({
              runId: confirmation.runId,
              lease: trackedWorkLease,
              controller: aborter,
              reason: 'User cancelled the run while confirmed command execution was active.',
          })
        : null;
    let cancellationTriggeredByInvalidation = false;
    // Capture before the batch owner exists. The check binds that exact owner
    // on its first in-transaction call and retains it across handler awaits.
    const isProjectMutationAuthorized = captureProjectMutationAuthorization();
    // Ownerless-mutation baseline for the post-batch rebind gate. The batch's
    // own writes (including its idempotency checkpoint) are owner-attributed,
    // so only a foreign writer moves this counter.
    const unownedMutationsBeforeBatch = captureUnownedProjectMutations();
    let renderJobAttempts = 0;
    try {
        const executionOptions = {
            ...group,
            signal: aborter.signal,
            source: 'prompt' as const,
            onDeferredEffectAttempt: (attempt: HandlerDeferredEffectAttempt) => {
                if (attempt.operation === 'renderProjectSections') {
                    renderJobAttempts += 1;
                }
            },
            onProjectCommitCheckpoint: ({ receipt }: { receipt: CommandVerifiedBatchReceipt }) => {
                return prepareAgentRunPendingEffectContinuation({
                    runId: confirmation.runId,
                    receipt,
                    commandBatch,
                });
            },
            requireCompensation: confirmation.executionMode === 'atomic',
            shouldExecute: () => {
                if (!isConfirmationExecutionAuthorized(isProjectMutationAuthorized, aborter.signal)) {
                    return false;
                }
                // Only abort, outside-writer, and actor authorization gate the
                // in-flight batch. The approval itself was fully validated by
                // getApprovalPreflightFailure before execution began, against
                // the pinned proposal revision; re-deriving that revision — or
                // target fingerprints — per action would read state this batch
                // has already mutated, so any batch touching what it plans to
                // change would invalidate itself mid-flight. Outside
                // interference is still caught by the one signal the batch
                // cannot move: mutations not owned by this exact action write
                // scope, including mutations owned by another app action.
                // The actor binding is re-checked separately because a
                // collaborator reconnect rotates localPeerId (same fallback
                // as compileAgentRiskApproval) without mutating anything.
                const approved = confirmation.approvalSnapshot;
                if (!approved.agentApproval) {
                    return true;
                }
                return (collaborationStore.value?.localPeerId ?? 'standalone') === approved.agentApproval.localActorId;
            },
        };
        const approved = confirmation.approvalSnapshot.agentApproval;
        if (!hasPriorVerifiedBatchReceipt && !approved) {
            throw new Error('The command batch has no exact risk approval binding.');
        }
        const approvalBinding =
            !hasPriorVerifiedBatchReceipt && approved
                ? issueAgentCommandApprovalBinding({ approval: approved, commandBatch })
                : undefined;
        await preparePendingActionResourceLeaseForCommit(confirmation.id, commandBatch);
        const batchResult = await executeVersionedCommandBatchEnvelope({
            authority: commandBatch.authority,
            ...(approvalBinding ? { approvalBinding } : {}),
            serialized: commandBatch.serialized,
            onProjectCommitPrepared: () => protectPendingActionResourceLease(confirmation.id),
            options: executionOptions,
        });
        const failedBeforeCommit =
            batchResult.status === 'rejected' || batchResult.status === 'conflicted' || batchResult.status === 'failed';
        if (
            (!recoveringPendingEffects && batchResult.status === 'cancelled') ||
            (!recoveringPendingEffects && failedBeforeCommit && !isProjectMutationAuthorized())
        ) {
            cancellationTriggeredByInvalidation = !aborter.signal.aborted;
            await agentRunCancellation.cancel({ runId: confirmation.runId, reason: batchResult.reason });
        }
        if (batchResult.status === 'previewed') {
            batchResult.resource.release();
            throw new Error('A confirmed command batch cannot execute in preview mode');
        }
        return {
            status: 'completed',
            batchResult,
            group,
            sectionRenderArtifactsBeforeExecution,
            isProjectMutationAuthorized,
            unownedMutationsBeforeBatch,
            renderJobAttempts,
            cancellationTriggeredByInvalidation,
            abortSignal: aborter.signal,
        };
    } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        if (hasCommittedProjectPriorReceipt(priorVerifiedBatchReceipt)) {
            const receiptPersistence = confirmedBatchOutcomeSupport.recordTrackedAgentRunReceipt(
                confirmation,
                priorVerifiedBatchReceipt,
                {
                    revertGroupId: group.groupId,
                    completesRun: false,
                }
            );
            const runPersistenceWarning = receiptPersistence.warning
                ? null
                : agentRunExecutionSettlement.recordPostCommitRecoveryFailure(confirmation, {
                      category: 'internal',
                      retriable: false,
                      receiptIdentity:
                          confirmedBatchOutcomeSupport.getVerifiedReceiptIdentity(priorVerifiedBatchReceipt),
                  });
            const recoveryFailureReason = [reason, receiptPersistence.warning, runPersistenceWarning]
                .filter(Boolean)
                .join(' ');
            updatePendingActionConfirmationStatus({
                confirmationId: confirmation.id,
                status: 'failed',
                error: recoveryFailureReason,
            });
            updateChatMessage(confirmation.assistantMessageId, {
                pendingActionConfirmationStatus: 'failed',
                error: recoveryFailureReason,
                content: `The project change remains durably committed, but pending-effect reconciliation could not continue: ${recoveryFailureReason}`,
            });
            await pendingActionResourceSettlement.retainCommitted(confirmation.id);
            return {
                status: 'recovery-failed',
                result: confirmedBatchOutcomeSupport.createCommittedEffectFailureResult(
                    priorVerifiedBatchReceipt,
                    recoveryFailureReason
                ),
            };
        }
        return { status: 'failed', error };
    } finally {
        releaseCommandCancellation?.();
        setActiveAborter(null);
        setChatGenerating(false);
    }
}
