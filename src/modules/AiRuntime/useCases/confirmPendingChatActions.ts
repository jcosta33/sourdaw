import { logger } from '#/infra/logger/appLogger';
import {
    getAgentSectionRenderArtifacts,
    rebindAgentProjectSectionArtifactRevisions,
} from '#/modules/AudioRendering/useCases';
import { collaborationStore } from '#/modules/Collaboration/stores';
import {
    executeVersionedCommandBatchEnvelope,
    generateGroupId,
    type refreshVersionedCommandBatchForApproval,
} from '#/modules/Command/useCases';
import {
    captureProjectMutationAuthorization,
    captureProjectRevision,
    captureUnownedProjectMutations,
} from '#/modules/CrdtDocument/useCases';
import { type HandlerDeferredEffectAttempt } from '#/utils/handlerContract';

import { AiProposalInvalidatedError } from '../errors/AiProposalInvalidatedError';
import { type AgentRunErrorCategory } from '../models/AgentRun';
import { type ChatActionConfirmationStatus } from '../models/Chat';
import { setActiveAborter, setChatGenerating, updateChatMessage } from '../stores/chatStore';
import {
    preparePendingActionResourceLeaseForCommit,
    protectPendingActionResourceLease,
    type PendingAppActionConfirmation,
    updatePendingActionConfirmationStatus,
} from '../stores/pendingActionConfirmationStore';

import { agentRunExecutionSettlement } from './agentRequestOrchestration/agentRunExecutionSettlement';
import { beginConfirmedCommandExecution } from './agentRequestOrchestration/beginConfirmedCommandExecution';
import { confirmationTerminalSettlement } from './agentRequestOrchestration/confirmationTerminalSettlement';
import {
    confirmedBatchOutcomeSupport,
    type CommandVerifiedBatchReceipt,
    type CommittedEffectFailureResult,
} from './agentRequestOrchestration/confirmedBatchOutcomeSupport';
import { executeCommittedSectionRenderRetry } from './agentRequestOrchestration/executeCommittedSectionRenderRetry';
import { pendingActionResourceSettlement } from './agentRequestOrchestration/pendingActionResourceSettlement';
import { confirmationAdmission } from './agentRequestOrchestration/resolveConfirmationAdmission';
import {
    AGENT_RUN_PERSISTENCE_WARNING,
    settleAgentRunWorkLeaseSafely,
} from './agentRequestOrchestration/settleAgentRunWorkLeaseSafely';
import { settleConfirmedBatchOutcome } from './agentRequestOrchestration/settleConfirmedBatchOutcome';
import { settleVerifiedBatchReplay } from './agentRequestOrchestration/settleVerifiedBatchReplay';
import { agentRunWorkLease } from './agentRunWorkLease';
import { agentRunCancellation } from './cancelAgentRun';
import { getVerifiedBatchReplayDisposition } from './getVerifiedBatchReplayDisposition';
import { issueAgentCommandApprovalBinding } from './issueAgentCommandApprovalBinding';
import { prepareAgentRunPendingEffectContinuation } from './prepareAgentRunPendingEffectContinuation';
import { recoverPreparedStemImportResources } from './recoverPreparedStemImportResources';

type ConfirmPendingChatActionsInput = {
    confirmationId: string;
};

type ApprovalDivergence = Extract<
    ReturnType<typeof refreshVersionedCommandBatchForApproval>,
    { status: 'ready' | 'conflicted' }
>['divergence'];

type ConfirmedBatchResult = Awaited<ReturnType<typeof executeVersionedCommandBatchEnvelope>>;

type ConfirmPendingChatActionsResult =
    | { status: 'missing' }
    | { status: 'not_pending'; currentStatus: ChatActionConfirmationStatus }
    | { status: 'busy' }
    | { status: 'executed' }
    | CommittedEffectFailureResult
    | { status: 'invalidated'; reason: string; divergence?: ApprovalDivergence }
    | {
          status: 'reapproval_required';
          divergence: ApprovalDivergence;
      }
    | { status: 'cancelled' }
    | { status: 'failed'; reason: string };

type ConfirmPendingChatActionsOutput = Promise<ConfirmPendingChatActionsResult>;

const COMPLETED_BATCH_STATUSES = new Set([
    'committed',
    'committed-with-warning',
    'executed',
    'executed-with-warning',
    'no-op',
]);

function getTrackedLeaseSettlementContract(batchResult: ConfirmedBatchResult): {
    terminalState: 'completed' | 'cancelled' | 'failed';
    evidence: 'none' | 'verified-command-receipt';
} {
    const outcome =
        batchResult.status === 'idempotent-replay'
            ? getVerifiedBatchReplayDisposition(batchResult.receipt).status
            : batchResult.status;
    let terminalState: 'completed' | 'cancelled' | 'failed' = 'failed';
    if (outcome === 'cancelled') {
        terminalState = 'cancelled';
    } else if (COMPLETED_BATCH_STATUSES.has(outcome)) {
        terminalState = 'completed';
    }
    const evidence =
        batchResult.status === 'idempotent-replay' ||
        batchResult.status === 'committed' ||
        batchResult.status === 'committed-with-warning' ||
        batchResult.status === 'executed' ||
        batchResult.status === 'executed-with-warning'
            ? 'verified-command-receipt'
            : 'none';
    return { terminalState, evidence };
}

function isConfirmationExecutionAuthorized(isProjectMutationAuthorized: () => boolean, signal: AbortSignal): boolean {
    if (signal.aborted) {
        return false;
    }
    return isProjectMutationAuthorized();
}

function rebindFreshSectionRenderArtifactsToCommittedRevision(
    confirmation: PendingAppActionConfirmation,
    artifactsBeforeExecution: ReturnType<typeof getAgentSectionRenderArtifacts>,
    committedRevision: string
): void {
    const renderAction = confirmation.approvalSnapshot.actions.find(
        (action) => action.type === 'renderProjectSections'
    );
    if (renderAction?.type !== 'renderProjectSections' || !renderAction.payload.jobs) {
        return;
    }
    const preexistingJobIds = new Set(artifactsBeforeExecution.map(({ jobId }) => jobId));
    const currentArtifacts = getAgentSectionRenderArtifacts();
    const freshArtifacts = renderAction.payload.jobs.flatMap((job) => {
        if (preexistingJobIds.has(job.jobId)) {
            return [];
        }
        const artifact = currentArtifacts.find(
            (candidate) =>
                candidate.jobId === job.jobId &&
                candidate.sectionId === job.sectionId &&
                candidate.sectionName === job.sectionName &&
                candidate.startBeat === job.startBeat &&
                candidate.endBeat === job.endBeat &&
                candidate.sampleRate === job.sampleRate &&
                candidate.tailSeconds === job.tailSeconds
        );
        return artifact ? [{ job, renderedAt: artifact.renderedAt, sourceRevision: artifact.sourceRevision }] : [];
    });
    // The durable receipt checkpoint advances the CRDT revision after post-commit
    // rendering; only exact artifacts created by this execution may follow it.
    rebindAgentProjectSectionArtifactRevisions({
        artifacts: freshArtifacts,
        sourceRevision: committedRevision,
    });
}

export async function confirmPendingChatActions(
    input: ConfirmPendingChatActionsInput
): ConfirmPendingChatActionsOutput {
    const admission = confirmationAdmission.consumeConfirmationAdmission(
        await confirmationAdmission.resolveConfirmationAdmission(input)
    );
    if (admission.status === 'handled') {
        return admission.result;
    }
    if (admission.status === 'render-retry') {
        return executeCommittedSectionRenderRetry({
            confirmation: admission.confirmation,
            durableReceipt: admission.durableReceipt,
            commandBatch: admission.commandBatch,
        });
    }
    const executionAdmission = beginConfirmedCommandExecution(admission);
    if (executionAdmission.status === 'settled') {
        return executionAdmission.result;
    }
    const {
        confirmation,
        commandBatch,
        trackedWorkLease,
        commandBudget,
        priorVerifiedBatchReceipt,
        recoveringPendingEffects,
    } = executionAdmission;
    const hasPriorVerifiedBatchReceipt = priorVerifiedBatchReceipt !== null;

    const group = confirmation.groupId
        ? { groupId: confirmation.groupId, groupLabel: confirmation.groupLabel }
        : generateGroupId(confirmation.prompt);
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
    let batchResult: Awaited<ReturnType<typeof executeVersionedCommandBatchEnvelope>>;
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
        const versionedResult = await executeVersionedCommandBatchEnvelope({
            authority: commandBatch.authority,
            ...(approvalBinding ? { approvalBinding } : {}),
            serialized: commandBatch.serialized,
            onProjectCommitPrepared: () => protectPendingActionResourceLease(confirmation.id),
            options: executionOptions,
        });
        const failedBeforeCommit =
            versionedResult.status === 'rejected' ||
            versionedResult.status === 'conflicted' ||
            versionedResult.status === 'failed';
        if (
            (!recoveringPendingEffects && versionedResult.status === 'cancelled') ||
            (!recoveringPendingEffects && failedBeforeCommit && !isProjectMutationAuthorized())
        ) {
            cancellationTriggeredByInvalidation = !aborter.signal.aborted;
            await agentRunCancellation.cancel({ runId: confirmation.runId, reason: versionedResult.reason });
        }
        if (versionedResult.status === 'previewed') {
            versionedResult.resource.release();
            throw new Error('A confirmed command batch cannot execute in preview mode');
        }
        batchResult = versionedResult;
    } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        if (recoveringPendingEffects && priorVerifiedBatchReceipt) {
            updatePendingActionConfirmationStatus({
                confirmationId: confirmation.id,
                status: 'failed',
                error: reason,
            });
            updateChatMessage(confirmation.assistantMessageId, {
                pendingActionConfirmationStatus: 'failed',
                error: reason,
                content: `The project change remains durably committed, but pending-effect reconciliation could not continue: ${reason}`,
            });
            await pendingActionResourceSettlement.retainCommitted(confirmation.id);
            return confirmedBatchOutcomeSupport.createCommittedEffectFailureResult(priorVerifiedBatchReceipt, reason);
        }
        let trackedLeaseSettlement: ReturnType<typeof settleAgentRunWorkLeaseSafely> = {
            accepted: true,
            warning: null,
        };
        if (trackedWorkLease) {
            trackedLeaseSettlement = settleAgentRunWorkLeaseSafely({
                lease: trackedWorkLease,
                terminalState: 'failed',
                evidence: 'none',
                settle: agentRunWorkLease.settle,
                reportFailure: (error) =>
                    logger.error(new Error('Agent run work lease settlement failed', { cause: error })),
            });
        }
        if (trackedLeaseSettlement.accepted) {
            agentRunExecutionSettlement.recordFailure(confirmation, {
                category: error instanceof AiProposalInvalidatedError ? 'conflict' : 'internal',
                retriable: false,
                ...(trackedWorkLease ? { workId: trackedWorkLease.workId } : {}),
                knownDomain: error instanceof AiProposalInvalidatedError,
            });
        }
        const userVisibleReason = [reason, trackedLeaseSettlement.warning].filter(Boolean).join(' ');
        updatePendingActionConfirmationStatus({
            confirmationId: confirmation.id,
            status: 'failed',
            error: userVisibleReason,
        });
        updateChatMessage(confirmation.assistantMessageId, {
            pendingActionConfirmationStatus: 'failed',
            error: userVisibleReason,
            content: `Failed to execute confirmed actions atomically:\n\n${userVisibleReason}`,
        });
        await pendingActionResourceSettlement.settleBestEffort({
            confirmationId: confirmation.id,
            disposition: 'discard',
        });
        return { status: 'failed', reason };
    } finally {
        releaseCommandCancellation?.();
        setActiveAborter(null);
        setChatGenerating(false);
    }

    const committedProjectRevision = captureProjectRevision();
    // The batch flight contains awaited boundaries, so a foreign project write
    // can land between the last render and this capture. Relabelling fresh
    // artifacts against a revision carrying one would defeat the retry's
    // sourceRevision guard, so the rebind runs only when no ownerless mutation
    // landed during the flight. The authorization check is not usable here: the
    // batch's own idempotency checkpoint write falsifies it even on a clean
    // success. A refused relabel leaves the renders detectably incomplete under
    // the committed revision; the project changes themselves stay committed.
    const canRebindSectionRenderArtifacts =
        (batchResult.status === 'committed' || batchResult.status === 'committed-with-warning') &&
        captureUnownedProjectMutations() === unownedMutationsBeforeBatch;
    if (canRebindSectionRenderArtifacts) {
        rebindFreshSectionRenderArtifactsToCommittedRevision(
            confirmation,
            sectionRenderArtifactsBeforeExecution,
            committedProjectRevision
        );
    }
    const budgetPersistenceWarning = commandBudget
        ? agentRunExecutionSettlement.reconcileCommandBudget({
              confirmation,
              ...commandBudget,
              actualRenderJobs: renderJobAttempts,
          })
        : null;

    let trackedLeaseSettlement: ReturnType<typeof settleAgentRunWorkLeaseSafely> = { accepted: true, warning: null };
    if (trackedWorkLease) {
        const settlementContract = getTrackedLeaseSettlementContract(batchResult);
        trackedLeaseSettlement = settleAgentRunWorkLeaseSafely({
            lease: trackedWorkLease,
            ...settlementContract,
            settle: agentRunWorkLease.settle,
            reportFailure: (error) =>
                logger.error(new Error('Agent run work lease settlement failed', { cause: error })),
        });
    }

    if (batchResult.status === 'idempotent-replay') {
        return settleVerifiedBatchReplay({
            confirmation,
            receipt: batchResult.receipt,
            recoveredExternalEffects:
                'recoveredExternalEffects' in batchResult && batchResult.recoveredExternalEffects === true,
            leaseSettlement: trackedLeaseSettlement,
        });
    }

    const batchFailedBeforeCommit =
        batchResult.status === 'rejected' || batchResult.status === 'conflicted' || batchResult.status === 'failed';
    if (!recoveringPendingEffects && batchFailedBeforeCommit && !isProjectMutationAuthorized()) {
        return confirmationTerminalSettlement.invalidateForProjectChange(confirmation);
    }

    if (batchResult.status === 'cancelled') {
        if (aborter.signal.aborted && !cancellationTriggeredByInvalidation) {
            return confirmationTerminalSettlement.cancelAcceptedConfirmation(confirmation);
        }
        return confirmationTerminalSettlement.invalidateForProjectChange(confirmation);
    }

    if (
        batchResult.status === 'committed' ||
        batchResult.status === 'committed-with-warning' ||
        batchResult.status === 'executed' ||
        batchResult.status === 'executed-with-warning'
    ) {
        return settleConfirmedBatchOutcome({
            confirmation,
            batchResult,
            groupId: group.groupId,
            committedProjectRevision,
            trackedLeaseSettlement,
            budgetPersistenceWarning,
            canRebindSectionRenderArtifacts,
            retainCommittedPendingActionResources: pendingActionResourceSettlement.retainCommitted,
        });
    }

    if (batchResult.status === 'no-op') {
        if (!trackedLeaseSettlement.accepted) {
            const warning = trackedLeaseSettlement.warning ?? AGENT_RUN_PERSISTENCE_WARNING;
            await pendingActionResourceSettlement.settleBestEffort({
                confirmationId: confirmation.id,
                disposition: 'discard',
            });
            updatePendingActionConfirmationStatus({
                confirmationId: confirmation.id,
                status: 'cancelled',
                error: warning,
            });
            updateChatMessage(confirmation.assistantMessageId, {
                pendingActionConfirmationStatus: 'cancelled',
                error: warning,
                content: `No project changes were needed after confirmation, but the run was already cancelled or replaced. ${warning}`,
            });
            return { status: 'cancelled' };
        }
        agentRunExecutionSettlement.completeNoOp(confirmation, trackedWorkLease?.workId);
        await pendingActionResourceSettlement.settleBestEffort({
            confirmationId: confirmation.id,
            disposition: 'discard',
        });
        updatePendingActionConfirmationStatus({
            confirmationId: confirmation.id,
            status: 'executed',
            ...(trackedLeaseSettlement.warning ? { error: trackedLeaseSettlement.warning } : {}),
        });
        updateChatMessage(confirmation.assistantMessageId, {
            pendingActionConfirmationStatus: 'executed',
            error: trackedLeaseSettlement.warning ?? undefined,
            content: ['No project changes were needed after confirmation.', trackedLeaseSettlement.warning]
                .filter(Boolean)
                .join(' '),
        });
        return { status: 'executed' };
    }

    if (batchResult.status === 'ambiguous') {
        const userVisibleReason = [batchResult.reason, trackedLeaseSettlement.warning].filter(Boolean).join(' ');
        if (recoveringPendingEffects && priorVerifiedBatchReceipt) {
            await pendingActionResourceSettlement.retainCommitted(confirmation.id);
            updatePendingActionConfirmationStatus({
                confirmationId: confirmation.id,
                status: 'failed',
                error: userVisibleReason,
            });
            updateChatMessage(confirmation.assistantMessageId, {
                pendingActionConfirmationStatus: 'failed',
                error: userVisibleReason,
                content: `The project change remains durably committed, but pending-effect reconciliation is still incomplete: ${userVisibleReason}`,
            });
            return confirmedBatchOutcomeSupport.createCommittedEffectFailureResult(
                priorVerifiedBatchReceipt,
                batchResult.reason
            );
        }
        if (trackedLeaseSettlement.accepted) {
            agentRunExecutionSettlement.recordFailure(confirmation, {
                category: 'conflict',
                retriable: false,
                ...(trackedWorkLease ? { workId: trackedWorkLease.workId } : {}),
                compensation: 'manual-repair',
            });
        }
        await pendingActionResourceSettlement.settleBestEffort({
            confirmationId: confirmation.id,
            disposition: 'retain',
        });
        await recoverPreparedStemImportResources({ runId: confirmation.runId });
        updatePendingActionConfirmationStatus({
            confirmationId: confirmation.id,
            status: 'failed',
            error: userVisibleReason,
        });
        updateChatMessage(confirmation.assistantMessageId, {
            pendingActionConfirmationStatus: 'failed',
            error: userVisibleReason,
            content: `The confirmed command stopped after an uncertain partial commit: ${batchResult.reason}. Do not retry it; inspect the project first.${trackedLeaseSettlement.warning ? ` ${trackedLeaseSettlement.warning}` : ''}`,
        });
        return { status: 'failed', reason: batchResult.reason };
    }

    if (recoveringPendingEffects && priorVerifiedBatchReceipt) {
        await pendingActionResourceSettlement.retainCommitted(confirmation.id);
        updatePendingActionConfirmationStatus({
            confirmationId: confirmation.id,
            status: 'failed',
            error: batchResult.reason,
        });
        updateChatMessage(confirmation.assistantMessageId, {
            pendingActionConfirmationStatus: 'failed',
            error: batchResult.reason,
            content: `The project change remains durably committed, but pending-effect reconciliation could not continue: ${batchResult.reason}`,
        });
        return confirmedBatchOutcomeSupport.createCommittedEffectFailureResult(
            priorVerifiedBatchReceipt,
            batchResult.reason
        );
    }

    const userVisibleFailure = [batchResult.reason, trackedLeaseSettlement.warning].filter(Boolean).join(' ');
    updatePendingActionConfirmationStatus({
        confirmationId: confirmation.id,
        status: 'failed',
        error: userVisibleFailure,
    });
    let failureCategory: AgentRunErrorCategory = 'project';
    if (batchResult.status === 'conflicted') {
        failureCategory = 'conflict';
    } else if (batchResult.status === 'rejected') {
        failureCategory = 'authorization';
    }
    if (trackedLeaseSettlement.accepted) {
        agentRunExecutionSettlement.recordFailure(confirmation, {
            category: failureCategory,
            retriable: false,
            ...(trackedWorkLease ? { workId: trackedWorkLease.workId } : {}),
        });
    }
    updateChatMessage(confirmation.assistantMessageId, {
        pendingActionConfirmationStatus: 'failed',
        error: userVisibleFailure,
        content: `Failed to execute confirmed actions atomically:\n\n${userVisibleFailure}`,
    });
    await pendingActionResourceSettlement.settleBestEffort({ confirmationId: confirmation.id, disposition: 'discard' });
    return { status: 'failed', reason: batchResult.reason };
}
