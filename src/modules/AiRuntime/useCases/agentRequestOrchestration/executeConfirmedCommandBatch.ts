import {
    getAgentSectionRenderArtifacts,
    rebindAgentProjectSectionArtifactRevisions,
} from '#/modules/AudioRendering/useCases';
import { collaborationStore } from '#/modules/Collaboration/stores';
import { executeVersionedCommandBatchEnvelope, parseVersionedCommandBatchEnvelope } from '#/modules/Command/useCases';
import { captureProjectMutationAuthorization, captureProjectRevision } from '#/modules/CrdtDocument/useCases';
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
import { getExactAgentActionHash } from '../getExactAgentActionHash';
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
          committedProjectRevision: string | null;
          finalizationEvidenceFailure: string | null;
          canRebindSectionRenderArtifacts: boolean;
          isProjectMutationAuthorized: () => boolean;
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

type ValidApprovedBatch = Extract<
    ReturnType<typeof parseVersionedCommandBatchEnvelope>,
    { status: 'valid' }
>['envelope'];
type ApprovedCommand = ValidApprovedBatch['commands'][number];
type ApprovedRenderAction = Extract<
    PendingAppActionConfirmation['approvalSnapshot']['actions'][number],
    { type: 'renderProjectSections' }
>;
type ApprovedRenderCommand = {
    command: ApprovedCommand;
    jobs: NonNullable<ApprovedRenderAction['payload']['jobs']>;
};

function getApprovedRenderCommands(
    confirmation: PendingAppActionConfirmation,
    commandBatch: ExecuteConfirmedCommandBatchInput['commandBatch']
): ApprovedRenderCommand[] {
    const parsedBatch = parseVersionedCommandBatchEnvelope(commandBatch.serialized, commandBatch.authority);
    if (parsedBatch.status !== 'valid') {
        throw new Error('The approved command batch is unavailable for section render artifact binding.');
    }
    const approvedActions = confirmation.approvalSnapshot.actions;
    if (parsedBatch.envelope.commands.length !== approvedActions.length) {
        throw new Error('The approved command batch does not exactly match the approved render actions.');
    }
    return approvedActions.flatMap((action, index) => {
        const command = parsedBatch.envelope.commands[index];
        const actionIsRender = action.type === 'renderProjectSections';
        const commandIsRender = command?.operation === 'renderProjectSections';
        if (!actionIsRender && !commandIsRender) {
            return [];
        }
        if (!actionIsRender || !commandIsRender || !command || !action.payload.jobs) {
            throw new Error('The approved render command cannot be bound to one exact approved action.');
        }
        const actionHash = getExactAgentActionHash({ operation: action.type, arguments: action.payload });
        const commandHash = getExactAgentActionHash({ operation: command.operation, arguments: command.arguments });
        if (actionHash !== commandHash) {
            throw new Error(`The approved render command payload does not match action ${command.commandId}.`);
        }
        return [{ command, jobs: action.payload.jobs }];
    });
}

function getCommittedRenderJobs(
    renderCommands: readonly ApprovedRenderCommand[],
    checkpointReceipt: CommandVerifiedBatchReceipt
) {
    const seenCommandIds = new Set<string>();
    const seenJobIds = new Set<string>();
    return renderCommands.flatMap(({ command, jobs }) => {
        if (seenCommandIds.has(command.commandId)) {
            throw new Error(`The approved render command identity is ambiguous: ${command.commandId}.`);
        }
        seenCommandIds.add(command.commandId);
        for (const job of jobs) {
            if (seenJobIds.has(job.jobId)) {
                throw new Error(`The approved section render job identity is ambiguous: ${job.jobId}.`);
            }
            seenJobIds.add(job.jobId);
        }
        const commandOutcomes = checkpointReceipt.commandOutcomes.filter(
            ({ commandId }) => commandId === command.commandId
        );
        const commandOutcome = commandOutcomes[0];
        if (commandOutcomes.length !== 1 || commandOutcome?.operation !== command.operation) {
            throw new Error(`The verified checkpoint has no exact outcome for render command ${command.commandId}.`);
        }
        const pendingEffects = checkpointReceipt.pendingEffects.filter(
            ({ commandId }) => commandId === command.commandId
        );
        if (
            pendingEffects.length > 1 ||
            (pendingEffects[0] !== undefined && pendingEffects[0].operation !== command.operation)
        ) {
            throw new Error(
                `The verified checkpoint has ambiguous pending effects for render command ${command.commandId}.`
            );
        }
        if (commandOutcome.outcome !== 'committed' || pendingEffects.length === 1) {
            return [];
        }
        const commandLinks = checkpointReceipt.links.render.filter(({ commandId }) => commandId === command.commandId);
        if (
            commandLinks.length !== jobs.length ||
            jobs.some((job) => commandLinks.filter(({ jobId }) => jobId === job.jobId).length !== 1)
        ) {
            throw new Error(
                `The verified checkpoint has ambiguous artifact links for render command ${command.commandId}.`
            );
        }
        return jobs;
    });
}

function getFreshArtifactBindings(
    committedJobs: ReturnType<typeof getCommittedRenderJobs>,
    artifactsBeforeExecution: ReturnType<typeof getAgentSectionRenderArtifacts>
) {
    const preexistingJobIds = new Set(artifactsBeforeExecution.map(({ jobId }) => jobId));
    const currentArtifacts = getAgentSectionRenderArtifacts();
    return committedJobs.map((job) => {
        const matchingArtifacts = currentArtifacts.filter(
            (candidate) =>
                candidate.jobId === job.jobId &&
                candidate.sectionId === job.sectionId &&
                candidate.sectionName === job.sectionName &&
                candidate.startBeat === job.startBeat &&
                candidate.endBeat === job.endBeat &&
                candidate.sampleRate === job.sampleRate &&
                candidate.tailSeconds === job.tailSeconds
        );
        const artifact = matchingArtifacts[0];
        if (preexistingJobIds.has(job.jobId) || matchingArtifacts.length !== 1 || !artifact) {
            throw new Error(`Exactly one fresh section render artifact is required for committed job ${job.jobId}.`);
        }
        return { job, renderedAt: artifact.renderedAt, sourceRevision: artifact.sourceRevision };
    });
}

function rebindFreshSectionRenderArtifactsToCommittedRevision(
    confirmation: PendingAppActionConfirmation,
    commandBatch: ExecuteConfirmedCommandBatchInput['commandBatch'],
    checkpointReceipt: CommandVerifiedBatchReceipt | null,
    artifactsBeforeExecution: ReturnType<typeof getAgentSectionRenderArtifacts>,
    committedRevision: string
): void {
    const renderCommands = getApprovedRenderCommands(confirmation, commandBatch);
    if (renderCommands.length === 0) {
        return;
    }
    if (!checkpointReceipt) {
        throw new Error('The verified project checkpoint receipt is unavailable for section render artifact binding.');
    }
    const committedJobs = getCommittedRenderJobs(renderCommands, checkpointReceipt);
    const bindings = getFreshArtifactBindings(committedJobs, artifactsBeforeExecution);
    rebindAgentProjectSectionArtifactRevisions({
        artifacts: bindings,
        sourceRevision: committedRevision,
    });
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
    let renderJobAttempts = 0;
    let committedProjectRevision: string | null = null;
    let finalizationEvidenceFailure: string | null = null;
    let canRebindSectionRenderArtifacts = false;
    let projectCommitCheckpointReceipt: CommandVerifiedBatchReceipt | null = null;
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
                projectCommitCheckpointReceipt = receipt;
                return prepareAgentRunPendingEffectContinuation({
                    runId: confirmation.runId,
                    receipt,
                    commandBatch,
                });
            },
            onProjectCommitFinalized: ({ revision }: { revision: string }) => {
                committedProjectRevision = revision;
                rebindFreshSectionRenderArtifactsToCommittedRevision(
                    confirmation,
                    commandBatch,
                    projectCommitCheckpointReceipt,
                    sectionRenderArtifactsBeforeExecution,
                    revision
                );
                canRebindSectionRenderArtifacts = true;
            },
            onProjectCommitFinalizationUnavailable: ({ reason }: { reason: string }) => {
                finalizationEvidenceFailure = reason;
            },
            shouldFinalizeProjectCommit: isProjectMutationAuthorized,
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
            committedProjectRevision,
            finalizationEvidenceFailure,
            canRebindSectionRenderArtifacts,
            isProjectMutationAuthorized,
            renderJobAttempts,
            cancellationTriggeredByInvalidation,
            abortSignal: aborter.signal,
        };
    } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        if (hasCommittedProjectPriorReceipt(priorVerifiedBatchReceipt)) {
            const runPersistenceWarning = agentRunExecutionSettlement.recordCommittedRecoveryFailure(confirmation, {
                category: 'internal',
                retriable: false,
                receipt: priorVerifiedBatchReceipt,
                actions: confirmation.actions,
                commandBatch,
                revertGroupId: group.groupId,
                committedRevision: captureProjectRevision(),
            });
            const recoveryFailureReason = [reason, runPersistenceWarning].filter(Boolean).join(' ');
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
