import { logger } from '#/infra/logger/appLogger';
import {
    getAgentSectionRenderArtifacts,
    rebindAgentProjectSectionArtifactRevisions,
} from '#/modules/AudioRendering/useCases';
import { collaborationStore } from '#/modules/Collaboration/stores';
import {
    executeVersionedCommandBatchEnvelope,
    generateGroupId,
    getVersionedCommandBatchIdempotentReplay,
    parseVersionedCommandBatchEnvelope,
    refreshVersionedCommandBatchForApproval,
} from '#/modules/Command/useCases';
import {
    captureProjectMutationAuthorization,
    captureProjectRevision,
    captureUnownedProjectMutations,
} from '#/modules/CrdtDocument/useCases';
import { type HandlerDeferredEffectAttempt } from '#/utils/handlerContract';

import { AiProposalInvalidatedError } from '../errors/AiProposalInvalidatedError';
import { type AgentRunErrorCategory, type AgentRunWorkLease } from '../models/AgentRun';
import { type ChatActionConfirmationStatus } from '../models/Chat';
import { chatStore, setActiveAborter, setChatGenerating, updateChatMessage } from '../stores/chatStore';
import {
    getPendingActionConfirmation,
    preparePendingActionResourceLeaseForCommit,
    protectPendingActionResourceLease,
    refreshPendingActionConfirmationApproval,
    type PendingAppActionConfirmation,
    updatePendingActionFollowUp,
    updatePendingActionConfirmationStatus,
} from '../stores/pendingActionConfirmationStore';

import { admitCommittedSectionRenderRetry } from './agentRequestOrchestration/admitCommittedSectionRenderRetry';
import { agentRunTerminalSupport } from './agentRequestOrchestration/agentRunTerminalSupport';
import {
    confirmedBatchOutcomeSupport,
    type CommandVerifiedBatchReceipt,
    type CommittedEffectFailureResult,
} from './agentRequestOrchestration/confirmedBatchOutcomeSupport';
import { executeCommittedSectionRenderRetry } from './agentRequestOrchestration/executeCommittedSectionRenderRetry';
import { pendingActionResourceSettlement } from './agentRequestOrchestration/pendingActionResourceSettlement';
import {
    AGENT_RUN_PERSISTENCE_WARNING,
    settleAgentRunWorkLeaseSafely,
} from './agentRequestOrchestration/settleAgentRunWorkLeaseSafely';
import { settleConfirmedBatchOutcome } from './agentRequestOrchestration/settleConfirmedBatchOutcome';
import { settleVerifiedBatchReplay } from './agentRequestOrchestration/settleVerifiedBatchReplay';
import { agentRunLifecycle } from './agentRunLifecycle';
import { agentRunWorkLease } from './agentRunWorkLease';
import { agentWorkBudget, type AgentWorkBudgetEstimate } from './agentWorkBudget';
import { agentRunCancellation } from './cancelAgentRun';
import { compileAgentRiskApproval } from './compileAgentRiskApproval';
import { getPlannedActionAffectedIds } from './getPlannedActionAffectedIds';
import { getVerifiedBatchReplayDisposition } from './getVerifiedBatchReplayDisposition';
import { issueAgentCommandApprovalBinding } from './issueAgentCommandApprovalBinding';
import { prepareAgentRunPendingEffectContinuation } from './prepareAgentRunPendingEffectContinuation';
import { recoverPreparedStemImportResources } from './recoverPreparedStemImportResources';
import { validateAgentRiskApproval } from './validateAgentRiskApproval';

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

const RENDER_RETRY_PROOF_MISMATCH_REASON =
    'The retained render retry proof no longer matches the committed project batch.';

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

function getProtectedAffectedIds(
    actions: readonly PendingAppActionConfirmation['actions'][number][],
    protectedTargets: readonly PendingAppActionConfirmation['protectedUnchanged'][number][]
): string[] {
    const protectedIds = new Set(protectedTargets.map((target) => target.id));
    return [
        ...new Set(
            actions.flatMap((action) => getPlannedActionAffectedIds(action)).filter((id) => protectedIds.has(id))
        ),
    ];
}

function getApprovalPreflightFailure(confirmation: PendingAppActionConfirmation): string | null {
    const approved = confirmation.approvalSnapshot;
    if (!approved.commandBatch) {
        return 'The confirmation has no approved command batch.';
    }
    if (!approved.agentApproval) {
        return 'The command batch has no exact risk approval binding.';
    }
    const validation = validateAgentRiskApproval({
        approval: approved.agentApproval,
        commandBatch: approved.commandBatch,
        currentRevision: captureProjectRevision(),
    });
    if (validation.status === 'invalid') {
        return validation.reason;
    }
    const protectedAffectedIds = getProtectedAffectedIds(confirmation.actions, approved.protectedUnchanged);
    if (protectedAffectedIds.length > 0) {
        return `The executable action batch targets protected IDs: ${protectedAffectedIds.join(', ')}.`;
    }

    const currentApproval = JSON.stringify({
        actions: confirmation.actions,
        actionLabels: confirmation.actionLabels,
        protectedUnchanged: confirmation.protectedUnchanged,
    });
    const immutableApproval = JSON.stringify({
        actions: approved.actions,
        actionLabels: approved.actionLabels,
        protectedUnchanged: approved.protectedUnchanged,
    });
    if (currentApproval !== immutableApproval) {
        return 'The executable action batch no longer matches the approved proposal.';
    }

    const approvedProtectedAffectedIds = getProtectedAffectedIds(approved.actions, approved.protectedUnchanged);
    if (approvedProtectedAffectedIds.length > 0) {
        return `The approved action batch targets protected IDs: ${approvedProtectedAffectedIds.join(', ')}.`;
    }

    return null;
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

function failCommittedSectionRenderRetryProof(
    confirmation: PendingAppActionConfirmation
): ConfirmPendingChatActionsResult {
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
        content: `The missing section renders were not retried because the retained proof no longer matches the approved batch and recorded commit evidence. Project actions were not replayed. Verify the project state before taking further action.`,
    });
    return { status: 'failed', reason: RENDER_RETRY_PROOF_MISMATCH_REASON };
}

function failUnreadableCommitEvidence(
    confirmation: PendingAppActionConfirmation,
    error: unknown,
    retryRemainsAvailable: boolean
): ConfirmPendingChatActionsResult {
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

export async function confirmPendingChatActions(
    input: ConfirmPendingChatActionsInput
): ConfirmPendingChatActionsOutput {
    let confirmation = getPendingActionConfirmation(input.confirmationId);
    if (!confirmation) {
        return { status: 'missing' };
    }
    const approvedCommandBatch = confirmation.approvalSnapshot.commandBatch;
    const wasProposed = confirmation.status === 'proposed';
    const initialRetryAdmission = admitCommittedSectionRenderRetry({
        confirmation,
        phase: 'eligibility',
    });
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
            // Unreadable commit evidence is not absence: never fail the retry
            // proof or re-execute against evidence that could not be read.
            return failUnreadableCommitEvidence(confirmation, error, wasRetryEligible);
        }
        const refreshedConfirmation = getPendingActionConfirmation(input.confirmationId);
        if (!refreshedConfirmation) {
            return { status: 'missing' };
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
            return { status: 'not_pending', currentStatus: refreshedConfirmation.status };
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
            const admittedCommandBatch = confirmation.approvalSnapshot.commandBatch;
            if (!admittedCommandBatch) {
                return failCommittedSectionRenderRetryProof(confirmation);
            }
            return executeCommittedSectionRenderRetry({
                confirmation,
                durableReceipt: retryAdmission.durableReceipt,
                commandBatch: admittedCommandBatch,
            });
        }
        if (retryAdmission.status === 'proof-mismatch') {
            return failCommittedSectionRenderRetryProof(confirmation);
        }
    }
    if (confirmation.status !== 'proposed') {
        return { status: 'not_pending', currentStatus: confirmation.status };
    }

    const hasPriorVerifiedBatchReceipt = priorVerifiedBatchReceipt !== null;
    const recoveringPendingEffects =
        priorVerifiedBatchReceipt?.outcome === 'partially-committed' &&
        priorVerifiedBatchReceipt.pendingEffects.length > 0;

    if (!hasPriorVerifiedBatchReceipt && captureProjectRevision() !== confirmation.projectRevision) {
        const commandBatch = confirmation.approvalSnapshot.commandBatch;
        if (!commandBatch) {
            return invalidatePendingConfirmation(confirmation);
        }
        const refreshed = refreshVersionedCommandBatchForApproval({
            authority: commandBatch.authority,
            serialized: commandBatch.serialized,
        });
        if (refreshed.status !== 'ready') {
            if (refreshed.status === 'conflicted') {
                return invalidatePendingConfirmationForDivergence(confirmation, refreshed.divergence);
            }
            return invalidatePendingConfirmation(confirmation);
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
            return invalidatePendingConfirmation(confirmation);
        }
        updateChatMessage(confirmation.assistantMessageId, {
            pendingActionConfirmationStatus: 'proposed',
            content: `The project changed after the prior approval. Divergence was classified as ${refreshed.divergence.kind}; the unchanged command plan was revalidated and rebound to the current project revision. Review and confirm again:\n\n${rebound.actionLabels.map((label) => `- ${label}`).join('\n')}`,
        });
        return { status: 'reapproval_required', divergence: refreshed.divergence };
    }

    if (chatStore.value?.isGenerating === true) {
        updateChatMessage(confirmation.assistantMessageId, {
            pendingActionConfirmationStatus: 'proposed',
            content: `Another AI command is still running. This proposal remains pending:\n\n${confirmation.actionLabels.map((label) => `- ${label}`).join('\n')}`,
        });
        return { status: 'busy' };
    }

    const approvalPreflightFailure = hasPriorVerifiedBatchReceipt ? null : getApprovalPreflightFailure(confirmation);
    if (approvalPreflightFailure) {
        return failApprovalPreflight(confirmation, approvalPreflightFailure, 'authorization');
    }

    const commandBatch = confirmation.approvalSnapshot.commandBatch;
    if (!commandBatch) {
        return failApprovalPreflight(confirmation, 'The confirmation has no approved command batch.', 'authorization');
    }
    let trackedWorkLease: AgentRunWorkLease | null = null;
    let commandBudget: { attemptId: string; estimates: AgentWorkBudgetEstimate[] } | null = null;
    if (agentRunLifecycle.get(confirmation.runId)) {
        const parsedCommandBatch = parseVersionedCommandBatchEnvelope(commandBatch.serialized, commandBatch.authority);
        if (parsedCommandBatch.status === 'invalid') {
            return failApprovalPreflight(confirmation, parsedCommandBatch.reason, 'schema');
        }
        const attemptId = `${parsedCommandBatch.envelope.batchId}:1`;
        const budgetReservation = hasPriorVerifiedBatchReceipt
            ? null
            : agentWorkBudget.reserveCommandWork({
                  runId: confirmation.runId,
                  envelope: parsedCommandBatch.envelope,
                  attemptId,
              });
        if (budgetReservation?.status === 'hard-limit-reached') {
            return failApprovalPreflight(
                confirmation,
                `The confirmed command work exceeds the user budget for ${budgetReservation.reason}.`,
                'budget'
            );
        }
        if (!hasPriorVerifiedBatchReceipt) {
            const receiptIdentity = `command:${confirmation.runId}:${parsedCommandBatch.envelope.batchId}`;
            const leaseResult = agentRunWorkLease.claim({
                runId: confirmation.runId,
                workId: parsedCommandBatch.envelope.batchId,
                ownerKind: 'command',
                cleanupOwner: 'command-executor',
                idempotencyKey: parsedCommandBatch.envelope.idempotencyKey,
                receiptIdentity,
                idempotent: true,
                retriable: false,
            });
            if (leaseResult.status !== 'claimed') {
                return failApprovalPreflight(
                    confirmation,
                    `The confirmed command work could not be claimed: ${leaseResult.status}`,
                    'conflict'
                );
            }
            trackedWorkLease = leaseResult.lease;
        }
        if (budgetReservation) {
            commandBudget = { attemptId, estimates: budgetReservation.estimates };
        }
    }

    updatePendingActionConfirmationStatus({ confirmationId: confirmation.id, status: 'accepted' });
    agentRunTerminalSupport.update(confirmation, () => {
        agentRunLifecycle.transitionPhase({
            runId: confirmation.runId,
            phase: 'executing',
            revision: confirmation.projectRevision,
        });
    });
    updateChatMessage(confirmation.assistantMessageId, {
        pendingActionConfirmationStatus: 'accepted',
        content: `Confirming:\n\n${confirmation.actionLabels.map((label) => `- ${label}`).join('\n')}`,
    });

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
            agentRunTerminalSupport.recordFailure(confirmation, {
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
        ? agentRunTerminalSupport.update(confirmation, () => {
              agentWorkBudget.reconcileCommandWork({
                  runId: confirmation.runId,
                  ...commandBudget,
                  actualRenderJobs: renderJobAttempts,
              });
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
        return invalidatePendingConfirmation(confirmation);
    }

    if (batchResult.status === 'cancelled') {
        if (aborter.signal.aborted && !cancellationTriggeredByInvalidation) {
            return cancelAcceptedConfirmation(confirmation);
        }
        return invalidatePendingConfirmation(confirmation);
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
        agentRunTerminalSupport.update(confirmation, () => {
            if (trackedWorkLease) {
                agentRunLifecycle.updateBatchStatus({
                    runId: confirmation.runId,
                    batchId: trackedWorkLease.workId,
                    status: 'no-op',
                });
            }
            agentRunLifecycle.transitionPhase({ runId: confirmation.runId, phase: 'completed' });
        });
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
            agentRunTerminalSupport.recordFailure(confirmation, {
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
        agentRunTerminalSupport.recordFailure(confirmation, {
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

async function failApprovalPreflight(
    confirmation: PendingAppActionConfirmation,
    reason: string,
    category: AgentRunErrorCategory
): Promise<ConfirmPendingChatActionsResult> {
    agentRunTerminalSupport.recordFailure(confirmation, {
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

async function invalidatePendingConfirmation(
    confirmation: PendingAppActionConfirmation
): Promise<Extract<ConfirmPendingChatActionsResult, { status: 'invalidated' }>> {
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

async function invalidatePendingConfirmationForDivergence(
    confirmation: PendingAppActionConfirmation,
    divergence: ApprovalDivergence
): Promise<Extract<ConfirmPendingChatActionsResult, { status: 'invalidated' }>> {
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
): Promise<ConfirmPendingChatActionsResult> {
    agentRunTerminalSupport.update(confirmation, () => {
        agentRunLifecycle.cancel({ runId: confirmation.runId, reason: 'User cancelled before the command committed.' });
    });
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
