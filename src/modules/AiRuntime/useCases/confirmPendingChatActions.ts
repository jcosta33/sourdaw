import { logger } from '#/infra/logger/appLogger';
import { getAgentSectionRenderArtifacts, retryAgentProjectSectionRenders } from '#/modules/AudioRendering/useCases';
import { collaborationStore } from '#/modules/Collaboration/stores';
import {
    executeAppActionBatch,
    executeVersionedCommandBatch,
    executeVersionedCommandBatchEnvelope,
    generateGroupId,
    getVersionedCommandBatchIdempotentReplay,
    parseVersionedCommandEnvelope,
    refreshVersionedCommandBatchForApproval,
} from '#/modules/Command/useCases';
import { captureProjectRevision, isDrumPreviewBranchPlanApplied } from '#/modules/CrdtDocument/useCases';

import { AiProposalInvalidatedError } from '../errors/AiProposalInvalidatedError';
import { type ChatActionConfirmationStatus } from '../models/Chat';
import { pushAiActionGroup, type AiActionGroup } from '../stores/aiActionHistoryStore';
import { chatStore, setActiveAborter, setChatGenerating, updateChatMessage } from '../stores/chatStore';
import {
    getPendingActionConfirmation,
    recordPendingActionExecution,
    refreshPendingActionConfirmationApproval,
    replacePendingActionExecutions,
    settlePendingActionResourceLease,
    type PendingActionExecution,
    type PendingAppActionConfirmation,
    updatePendingActionFollowUp,
    updatePendingActionConfirmationStatus,
} from '../stores/pendingActionConfirmationStore';

import { compileAgentRiskApproval } from './compileAgentRiskApproval';
import { getPlannedActionAffectedIds } from './getPlannedActionAffectedIds';
import { getVerifiedBatchReplayDisposition } from './getVerifiedBatchReplayDisposition';
import { notifyAiChange } from './notifyAiChange';
import { validateAgentRiskApproval } from './validateAgentRiskApproval';

type ConfirmPendingChatActionsInput = {
    confirmationId: string;
};

type ApprovalDivergence = Extract<
    ReturnType<typeof refreshVersionedCommandBatchForApproval>,
    { status: 'ready' | 'conflicted' }
>['divergence'];

type ConfirmPendingChatActionsResult =
    | { status: 'missing' }
    | { status: 'not_pending'; currentStatus: ChatActionConfirmationStatus }
    | { status: 'busy' }
    | { status: 'executed' }
    | { status: 'invalidated'; reason: string; divergence?: ApprovalDivergence }
    | {
          status: 'reapproval_required';
          divergence: ApprovalDivergence;
      }
    | { status: 'cancelled' }
    | { status: 'failed'; reason: string };

type ConfirmPendingChatActionsOutput = Promise<ConfirmPendingChatActionsResult>;

type VerifiedBatchReplayReceipt = Parameters<typeof getVerifiedBatchReplayDisposition>[0];

function settleVerifiedBatchReplay(
    confirmation: PendingAppActionConfirmation,
    receipt: VerifiedBatchReplayReceipt,
    recoveredExternalEffects = false
): ConfirmPendingChatActionsResult {
    const replay = getVerifiedBatchReplayDisposition(receipt);
    if (replay.status === 'committed' || replay.status === 'executed') {
        settlePendingActionResourceLease({ confirmationId: confirmation.id, disposition: 'retain' });
        updatePendingActionConfirmationStatus({
            confirmationId: confirmation.id,
            status: 'executed',
            error: replay.warning,
        });
        const effect =
            replay.status === 'committed' ? 'project batch was already committed' : 'runtime batch already executed';
        const warning = replay.warning ? ` The prior receipt also reports: ${replay.warning}` : '';
        const content = recoveredExternalEffects
            ? `This exact ${effect}. Pending external effects were reconciled successfully and the recovered verified receipt was returned.${warning}`
            : `This exact ${effect}. The prior verified receipt was returned without replaying project or runtime effects.${warning}`;
        updateChatMessage(confirmation.assistantMessageId, {
            pendingActionConfirmationStatus: 'executed',
            error: replay.warning,
            content,
        });
        return { status: 'executed' };
    }
    if (replay.status === 'no-op') {
        settlePendingActionResourceLease({ confirmationId: confirmation.id, disposition: 'retain' });
        updatePendingActionConfirmationStatus({ confirmationId: confirmation.id, status: 'executed' });
        updateChatMessage(confirmation.assistantMessageId, {
            pendingActionConfirmationStatus: 'executed',
            content: 'The prior verified receipt records a no-op. No project or runtime effects were applied.',
        });
        return { status: 'executed' };
    }
    if (replay.status === 'cancelled') {
        updatePendingActionConfirmationStatus({ confirmationId: confirmation.id, status: 'cancelled' });
        updateChatMessage(confirmation.assistantMessageId, {
            pendingActionConfirmationStatus: 'cancelled',
            error: undefined,
            content: 'The prior verified receipt records cancellation before commit. No project changes were applied.',
        });
        settlePendingActionResourceLease({ confirmationId: confirmation.id, disposition: 'discard' });
        return { status: 'cancelled' };
    }
    settlePendingActionResourceLease({
        confirmationId: confirmation.id,
        disposition: replay.status === 'ambiguous' ? 'retain' : 'discard',
    });
    updatePendingActionConfirmationStatus({
        confirmationId: confirmation.id,
        status: 'failed',
        error: replay.reason,
    });
    updateChatMessage(confirmation.assistantMessageId, {
        pendingActionConfirmationStatus: 'failed',
        error: replay.reason,
        content:
            replay.status === 'ambiguous'
                ? `The prior verified receipt records an ambiguous outcome: ${replay.reason}. Do not retry it; inspect the project first.`
                : `The prior verified receipt records that this command batch did not apply successfully: ${replay.reason}`,
    });
    return { status: 'failed', reason: replay.reason };
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

function isConfirmationExecutionAuthorized(confirmation: PendingAppActionConfirmation, signal: AbortSignal): boolean {
    if (signal.aborted) {
        return false;
    }
    if (captureProjectRevision() === confirmation.projectRevision) {
        return true;
    }
    const actions = confirmation.approvalSnapshot.actions;
    return (
        actions.length === 1 &&
        actions[0]?.type === 'createDrumPreviewBranches' &&
        isDrumPreviewBranchPlanApplied(actions[0])
    );
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
    if (approved.commandBatch) {
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

function getSectionRenderReceiptScope(confirmation: PendingAppActionConfirmation) {
    const renderAction = confirmation.approvalSnapshot.actions.find(
        (action) => action.type === 'renderProjectSections'
    );
    if (renderAction?.type !== 'renderProjectSections' || !renderAction.payload.jobs) {
        return null;
    }
    const artifacts = getAgentSectionRenderArtifacts();
    const completedJobIds = new Set<string>();
    const completedAffectedIds = new Set<string>();
    for (const job of renderAction.payload.jobs) {
        const matchingArtifact = artifacts.some(
            (artifact) =>
                artifact.jobId === job.jobId &&
                artifact.sectionId === job.sectionId &&
                artifact.sectionName === job.sectionName &&
                artifact.startBeat === job.startBeat &&
                artifact.endBeat === job.endBeat &&
                artifact.sampleRate === job.sampleRate &&
                artifact.tailSeconds === job.tailSeconds
        );
        if (matchingArtifact) {
            completedJobIds.add(job.jobId);
            completedAffectedIds.add(job.sectionId);
            completedAffectedIds.add(job.jobId);
        }
    }
    return {
        jobs: renderAction.payload.jobs,
        plannedAffectedIds: getPlannedActionAffectedIds(renderAction),
        plannedRenderAffectedIds: new Set(renderAction.payload.jobs.flatMap((job) => [job.sectionId, job.jobId])),
        completedAffectedIds,
        completedJobIds,
    };
}

function getActualExecutionAffectedIds(
    execution: PendingActionExecution,
    confirmation: PendingAppActionConfirmation
): string[] {
    if (execution.actionType !== 'renderProjectSections') {
        return execution.affectedIds;
    }
    const scope = getSectionRenderReceiptScope(confirmation);
    if (!scope) {
        return execution.affectedIds;
    }
    const nonRenderAffectedIds = execution.affectedIds.filter((id) => !scope.plannedRenderAffectedIds.has(id));
    const completedPlannedAffectedIds = scope.plannedAffectedIds.filter((id) => scope.completedAffectedIds.has(id));
    return [...new Set([...nonRenderAffectedIds, ...completedPlannedAffectedIds])];
}

function refreshPendingActionExecutions(confirmation: PendingAppActionConfirmation): PendingAppActionConfirmation {
    const current = getPendingActionConfirmation(confirmation.id) ?? confirmation;
    const executions = current.executedActions.map((execution) => ({
        ...execution,
        affectedIds: getActualExecutionAffectedIds(execution, current),
    }));
    return replacePendingActionExecutions({ confirmationId: current.id, executions }) ?? current;
}

function formatExecutionReceipt(
    executions: readonly PendingActionExecution[],
    confirmation: PendingAppActionConfirmation
): string {
    const executedActions = executions
        .map((execution) => {
            const actualAffectedIds = getActualExecutionAffectedIds(execution, confirmation);
            const affectedIds = actualAffectedIds.length > 0 ? actualAffectedIds.join(', ') : 'none';
            const assignedIds = (execution.applicationAssigned?.ids ?? [])
                .map(({ field, value }) => `${field}=${value}`)
                .join(', ');
            const assignedTimestamps = (execution.applicationAssigned?.timestamps ?? [])
                .map(({ field, value }) => `${field}=${String(value)}`)
                .join(', ');
            const commandMetadata = execution.commandId
                ? `\n  - Command: v${String(execution.commandSchemaVersion)} ${execution.commandId}\n  - Application-assigned IDs: ${assignedIds || 'none'}\n  - Application-assigned timestamps: ${assignedTimestamps || 'none'}`
                : '';
            return `- **${execution.actionType}**: ${execution.label}${commandMetadata}\n  - Affected IDs: ${affectedIds}\n  - Outcome: ${execution.outcome}`;
        })
        .join('\n');
    const protectedAffectedIds = new Set(
        executions.flatMap((execution) => getActualExecutionAffectedIds(execution, confirmation))
    );
    const approvedProtectedTargets = confirmation.approvalSnapshot.protectedUnchanged;
    const preservedProtectedTargets = approvedProtectedTargets.every((target) => !protectedAffectedIds.has(target.id));
    if (!preservedProtectedTargets) {
        return executedActions;
    }
    const protectedUnchanged = approvedProtectedTargets.map((target) => `"${target.name}" (${target.id})`).join(', ');
    if (!protectedUnchanged) {
        return executedActions;
    }
    return `${executedActions}\n\nProtected unchanged: ${protectedUnchanged}`;
}

function getIncompleteSectionRenderJobs(confirmation: PendingAppActionConfirmation) {
    const scope = getSectionRenderReceiptScope(confirmation);
    if (!scope) {
        return null;
    }
    const missingJobIds = scope.jobs.filter((job) => !scope.completedJobIds.has(job.jobId)).map((job) => job.jobId);
    return missingJobIds.length > 0 ? { jobs: scope.jobs, missingJobIds } : null;
}

async function retryCommittedSectionRenders(
    confirmation: PendingAppActionConfirmation
): ConfirmPendingChatActionsOutput {
    if (chatStore.value?.isGenerating === true) {
        return { status: 'busy' };
    }
    const followUp = getIncompleteSectionRenderJobs(confirmation);
    if (!followUp) {
        updatePendingActionFollowUp({ confirmationId: confirmation.id, error: null, status: 'complete' });
        updatePendingActionConfirmationStatus({ confirmationId: confirmation.id, status: 'executed' });
        const refreshedConfirmation = refreshPendingActionExecutions(confirmation);
        updateChatMessage(confirmation.assistantMessageId, {
            pendingActionFollowUpStatus: 'complete',
            error: undefined,
            content: `Applied after confirmation:\n\n${formatExecutionReceipt(
                refreshedConfirmation.executedActions,
                refreshedConfirmation
            )}\n\nAll section render artifacts are complete; project actions were not replayed.`,
        });
        return { status: 'executed' };
    }

    const sourceRevision = confirmation.followUpProjectRevision;
    if (!sourceRevision || captureProjectRevision() !== sourceRevision) {
        const reason =
            'Project changed after the committed render receipt; the missing original artifacts cannot be recreated safely.';
        updatePendingActionFollowUp({ confirmationId: confirmation.id, error: reason, status: 'failed' });
        updatePendingActionConfirmationStatus({ confirmationId: confirmation.id, status: 'executed', error: reason });
        updateChatMessage(confirmation.assistantMessageId, {
            pendingActionConfirmationStatus: 'executed',
            pendingActionFollowUpStatus: 'failed',
            error: reason,
            content: `The project changes remain committed, but the missing section renders were not retried: ${reason}`,
        });
        return { status: 'failed', reason };
    }

    updatePendingActionFollowUp({ confirmationId: confirmation.id, status: 'running' });
    updateChatMessage(confirmation.assistantMessageId, { pendingActionFollowUpStatus: 'running' });
    setChatGenerating(true);
    try {
        await retryAgentProjectSectionRenders({ jobs: followUp.jobs, sourceRevision });
        const remaining = getIncompleteSectionRenderJobs(confirmation);
        if (remaining) {
            throw new Error(`Section render jobs remain incomplete: ${remaining.missingJobIds.join(', ')}`);
        }
    } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        updatePendingActionFollowUp({ confirmationId: confirmation.id, error: reason, status: 'retryable' });
        updatePendingActionConfirmationStatus({ confirmationId: confirmation.id, status: 'executed', error: reason });
        const refreshedConfirmation = refreshPendingActionExecutions(confirmation);
        updateChatMessage(confirmation.assistantMessageId, {
            pendingActionConfirmationStatus: 'executed',
            pendingActionFollowUpStatus: 'retryable',
            error: reason,
            content: `Applied after confirmation:\n\n${formatExecutionReceipt(
                refreshedConfirmation.executedActions,
                refreshedConfirmation
            )}\n\nThe project actions remain committed. Missing section renders are still incomplete: ${reason}. Retry missing renders without replaying the project actions.`,
        });
        return { status: 'failed', reason };
    } finally {
        setChatGenerating(false);
    }

    updatePendingActionFollowUp({ confirmationId: confirmation.id, error: null, status: 'complete' });
    updatePendingActionConfirmationStatus({ confirmationId: confirmation.id, status: 'executed' });
    const refreshedConfirmation = refreshPendingActionExecutions(confirmation);
    updateChatMessage(confirmation.assistantMessageId, {
        pendingActionConfirmationStatus: 'executed',
        pendingActionFollowUpStatus: 'complete',
        error: undefined,
        content: `Applied after confirmation:\n\n${formatExecutionReceipt(
            refreshedConfirmation.executedActions,
            refreshedConfirmation
        )}\n\nMissing section render artifacts completed without replaying project actions.`,
    });
    return { status: 'executed' };
}

export async function confirmPendingChatActions(
    input: ConfirmPendingChatActionsInput
): ConfirmPendingChatActionsOutput {
    const confirmation = getPendingActionConfirmation(input.confirmationId);
    if (!confirmation) {
        return { status: 'missing' };
    }
    if (confirmation.status === 'executed' && confirmation.followUpStatus === 'retryable') {
        return retryCommittedSectionRenders(confirmation);
    }
    if (confirmation.status !== 'proposed') {
        return { status: 'not_pending', currentStatus: confirmation.status };
    }

    const approvedCommandBatch = confirmation.approvalSnapshot.commandBatch;
    let hasPriorVerifiedBatchReceipt = false;
    if (approvedCommandBatch) {
        const priorReceipt = await getVersionedCommandBatchIdempotentReplay({
            authority: approvedCommandBatch.authority,
            serialized: approvedCommandBatch.serialized,
        });
        hasPriorVerifiedBatchReceipt = priorReceipt !== null;
    }

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
        return failApprovalPreflight(confirmation, approvalPreflightFailure);
    }

    updatePendingActionConfirmationStatus({ confirmationId: confirmation.id, status: 'accepted' });
    updateChatMessage(confirmation.assistantMessageId, {
        pendingActionConfirmationStatus: 'accepted',
        content: `Confirming:\n\n${confirmation.actionLabels.map((label) => `- ${label}`).join('\n')}`,
    });

    const group = confirmation.groupId
        ? { groupId: confirmation.groupId, groupLabel: confirmation.groupLabel }
        : generateGroupId(confirmation.prompt);
    const aborter = new AbortController();
    setChatGenerating(true);
    setActiveAborter(aborter);
    let batchResult:
        | Awaited<ReturnType<typeof executeAppActionBatch>>
        | Awaited<ReturnType<typeof executeVersionedCommandBatchEnvelope>>;
    try {
        const executionOptions = {
            ...group,
            source: 'prompt' as const,
            requireCompensation: confirmation.executionMode === 'atomic',
            shouldExecute: () => {
                if (!isConfirmationExecutionAuthorized(confirmation, aborter.signal)) {
                    return false;
                }
                // Only abort, revision, and actor authorization gate the
                // in-flight batch. The approval itself was fully validated by
                // getApprovalPreflightFailure before execution began;
                // re-deriving target fingerprints per action would read
                // target state this batch has already mutated, so any
                // multi-action batch touching a fingerprinted target would
                // invalidate itself mid-flight. External interference is
                // still caught here: every project mutation moves the
                // revision heads isConfirmationExecutionAuthorized compares.
                // The actor binding is re-checked separately because a
                // collaborator reconnect rotates localPeerId (same fallback
                // as compileAgentRiskApproval) without moving those heads.
                const approved = confirmation.approvalSnapshot;
                if (!approved.agentApproval) {
                    return true;
                }
                return (collaborationStore.value?.localPeerId ?? 'standalone') === approved.agentApproval.localActorId;
            },
        };
        const commandEnvelopes = confirmation.approvalSnapshot.commandEnvelopes;
        const commandBatch = confirmation.approvalSnapshot.commandBatch;
        if (commandBatch) {
            const versionedResult = await executeVersionedCommandBatchEnvelope({
                authority: commandBatch.authority,
                confirmed: true,
                serialized: commandBatch.serialized,
                options: executionOptions,
            });
            if (versionedResult.status === 'previewed') {
                versionedResult.resource.release();
                throw new Error('A confirmed command batch cannot execute in preview mode');
            }
            batchResult = versionedResult;
        } else if (commandEnvelopes) {
            batchResult = await executeVersionedCommandBatch({
                commands: commandEnvelopes,
                normalizedProjectRevision: captureProjectRevision(),
                options: executionOptions,
            });
        } else {
            batchResult = await executeAppActionBatch(confirmation.approvalSnapshot.actions, executionOptions);
        }
    } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        updatePendingActionConfirmationStatus({
            confirmationId: confirmation.id,
            status: 'failed',
            error: reason,
        });
        updateChatMessage(confirmation.assistantMessageId, {
            pendingActionConfirmationStatus: 'failed',
            error: reason,
            content: `Failed to execute confirmed actions atomically:\n\n${reason}`,
        });
        settlePendingActionResourceLease({ confirmationId: confirmation.id, disposition: 'discard' });
        return { status: 'failed', reason };
    } finally {
        setActiveAborter(null);
        setChatGenerating(false);
    }

    if (batchResult.status === 'idempotent-replay') {
        return settleVerifiedBatchReplay(
            confirmation,
            batchResult.receipt,
            'recoveredExternalEffects' in batchResult && batchResult.recoveredExternalEffects === true
        );
    }

    if (batchResult.status === 'cancelled') {
        if (aborter.signal.aborted) {
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
        settlePendingActionResourceLease({ confirmationId: confirmation.id, disposition: 'retain' });
        let executionKind: 'project' | 'runtime' = 'project';
        if (batchResult.status === 'executed' || batchResult.status === 'executed-with-warning') {
            executionKind = 'runtime';
        }
        const approvalLabelsByCommandId = getApprovalLabelsByCommandId(confirmation);
        const executedLabels: PendingActionExecution[] = batchResult.actions.map(
            ({ action, label, receipt }, index) => {
                const approvedLabel = receipt ? approvalLabelsByCommandId.get(receipt.commandId) : undefined;
                const execution: PendingActionExecution = {
                    actionType: action.type,
                    label: approvedLabel ?? confirmation.approvalSnapshot.actionLabels[index] ?? label,
                    executionKind,
                    affectedIds: getPlannedActionAffectedIds(action),
                    ...(receipt
                        ? {
                              commandId: receipt.commandId,
                              commandSchemaVersion: receipt.schemaVersion,
                              applicationAssigned: {
                                  ids: [...receipt.applicationAssigned.ids],
                                  timestamps: [...receipt.applicationAssigned.timestamps],
                              },
                          }
                        : {}),
                    outcome: batchResult.status,
                };
                return {
                    ...execution,
                    affectedIds: getActualExecutionAffectedIds(execution, confirmation),
                };
            }
        );
        const executionReceipt = formatExecutionReceipt(executedLabels, confirmation);
        let warning: string | undefined;
        if (batchResult.status === 'committed-with-warning' || batchResult.status === 'executed-with-warning') {
            warning = batchResult.warning;
        }
        try {
            for (const execution of executedLabels) {
                recordPendingActionExecution({ confirmationId: confirmation.id, execution });
            }
            const historyGroup: AiActionGroup = {
                id: group.groupId,
                prompt: confirmation.prompt,
                actions: executedLabels.map((entry) => ({
                    kind: 'appAction',
                    actionType: entry.actionType,
                    label: entry.label,
                })),
                groupId: group.groupId,
                timestamp: Date.now(),
                reverted: false,
                executionKind,
            };
            pushAiActionGroup(historyGroup);
            notifyAiChange(
                `Confirmed: ${confirmation.prompt}`,
                executedLabels.map((entry) => entry.actionType)
            );
            updatePendingActionConfirmationStatus({ confirmationId: confirmation.id, status: 'executed' });
            const incompleteSectionRenders = getIncompleteSectionRenderJobs(confirmation);
            if (incompleteSectionRenders && batchResult.status === 'committed-with-warning') {
                updatePendingActionFollowUp({
                    confirmationId: confirmation.id,
                    error: batchResult.warning,
                    projectRevision: captureProjectRevision(),
                    status: 'retryable',
                });
            }
            let content = `Executed after confirmation:\n\n${executionReceipt}`;
            if (batchResult.status === 'committed-with-warning') {
                content = `Applied after confirmation:\n\n${executionReceipt}\n\nThe project change committed with a follow-up warning: ${batchResult.warning}. Do not retry these confirmed actions.`;
                if (incompleteSectionRenders) {
                    content = `Applied after confirmation:\n\n${executionReceipt}\n\nThe project change committed with a follow-up warning: ${batchResult.warning}. Do not replay the confirmed project actions. Retry missing renders below; only receipt-bound missing artifacts will run.`;
                }
            }
            if (batchResult.status === 'executed-with-warning') {
                content = `Executed after confirmation:\n\n${executionReceipt}\n\nThe runtime command executed with a follow-up warning: ${batchResult.warning}. Do not retry these confirmed actions.`;
            }
            updateChatMessage(confirmation.assistantMessageId, {
                pendingActionConfirmationStatus: 'executed',
                pendingActionFollowUpStatus: incompleteSectionRenders ? 'retryable' : undefined,
                error: warning,
                content,
            });
        } catch (error) {
            const warning = error instanceof Error ? error.message : String(error);
            logger.error(new Error('Confirmed AI action reporting failed after execution', { cause: error }));
            try {
                updatePendingActionConfirmationStatus({
                    confirmationId: confirmation.id,
                    status: 'executed',
                    error: warning,
                });
                let executionDescription = 'project change committed';
                if (executionKind === 'runtime') {
                    executionDescription = 'runtime command executed';
                }
                updateChatMessage(confirmation.assistantMessageId, {
                    pendingActionConfirmationStatus: 'executed',
                    error: warning,
                    content: `The confirmed ${executionDescription}, but reporting it failed: ${warning}. Do not retry these actions.\n\n${executionReceipt}`,
                });
            } catch (reportingError) {
                logger.error(
                    new Error('Confirmed AI post-execution warning could not be persisted', {
                        cause: reportingError,
                    })
                );
            }
        }
        return { status: 'executed' };
    }

    if (batchResult.status === 'no-op') {
        settlePendingActionResourceLease({ confirmationId: confirmation.id, disposition: 'retain' });
        updatePendingActionConfirmationStatus({ confirmationId: confirmation.id, status: 'executed' });
        updateChatMessage(confirmation.assistantMessageId, {
            pendingActionConfirmationStatus: 'executed',
            content: 'No project changes were needed after confirmation.',
        });
        return { status: 'executed' };
    }

    if (batchResult.status === 'ambiguous') {
        settlePendingActionResourceLease({ confirmationId: confirmation.id, disposition: 'retain' });
        updatePendingActionConfirmationStatus({
            confirmationId: confirmation.id,
            status: 'failed',
            error: batchResult.reason,
        });
        updateChatMessage(confirmation.assistantMessageId, {
            pendingActionConfirmationStatus: 'failed',
            error: batchResult.reason,
            content: `The confirmed command stopped after an uncertain partial commit: ${batchResult.reason}. Do not retry it; inspect the project first.`,
        });
        return { status: 'failed', reason: batchResult.reason };
    }

    updatePendingActionConfirmationStatus({
        confirmationId: confirmation.id,
        status: 'failed',
        error: batchResult.reason,
    });
    updateChatMessage(confirmation.assistantMessageId, {
        pendingActionConfirmationStatus: 'failed',
        error: batchResult.reason,
        content: `Failed to execute confirmed actions atomically:\n\n${batchResult.reason}`,
    });
    settlePendingActionResourceLease({ confirmationId: confirmation.id, disposition: 'discard' });
    return { status: 'failed', reason: batchResult.reason };
}

function failApprovalPreflight(
    confirmation: PendingAppActionConfirmation,
    reason: string
): ConfirmPendingChatActionsResult {
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
    settlePendingActionResourceLease({ confirmationId: confirmation.id, disposition: 'discard' });
    return { status: 'failed', reason };
}

function invalidatePendingConfirmation(
    confirmation: PendingAppActionConfirmation
): Extract<ConfirmPendingChatActionsResult, { status: 'invalidated' }> {
    const reason = new AiProposalInvalidatedError().message;
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
    settlePendingActionResourceLease({ confirmationId: confirmation.id, disposition: 'discard' });
    return { status: 'invalidated', reason };
}

function invalidatePendingConfirmationForDivergence(
    confirmation: PendingAppActionConfirmation,
    divergence: ApprovalDivergence
): Extract<ConfirmPendingChatActionsResult, { status: 'invalidated' }> {
    const targetIds = divergence.targetIds.length > 0 ? divergence.targetIds.join(', ') : 'none';
    const candidates = divergence.repairCandidates
        .map((candidate) => `${candidate.kind}: ${candidate.targetIds.join(', ') || 'project'}`)
        .join('; ');
    const reason = `The approved command was not executed because project divergence is ${divergence.kind}.`;
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
    settlePendingActionResourceLease({ confirmationId: confirmation.id, disposition: 'discard' });
    return { status: 'invalidated', reason, divergence };
}

function cancelAcceptedConfirmation(confirmation: PendingAppActionConfirmation): ConfirmPendingChatActionsResult {
    updatePendingActionConfirmationStatus({
        confirmationId: confirmation.id,
        status: 'cancelled',
    });
    updateChatMessage(confirmation.assistantMessageId, {
        pendingActionConfirmationStatus: 'cancelled',
        error: undefined,
        content: 'Command cancelled before it committed. No project changes were applied.',
    });
    settlePendingActionResourceLease({ confirmationId: confirmation.id, disposition: 'discard' });
    return { status: 'cancelled' };
}
