import { logger } from '#/infra/logger/appLogger';
import { type executeVersionedCommandBatchEnvelope, type generateGroupId } from '#/modules/Command/useCases';

import { pushAiActionGroup, type AiActionGroup } from '../../stores/aiActionHistoryStore';
import { updateChatMessage } from '../../stores/chatStore';
import {
    getPendingActionConfirmation,
    recordPendingActionExecution,
    type PendingActionExecution,
    type PendingAppActionConfirmation,
    updatePendingActionConfirmationStatus,
    updatePendingActionFollowUp,
} from '../../stores/pendingActionConfirmationStore';
import { getPlannedActionAffectedIds } from '../getPlannedActionAffectedIds';
import { notifyAiChange } from '../notifyAiChange';

import { admitCommittedSectionRenderRetry } from './admitCommittedSectionRenderRetry';
import { confirmedBatchOutcomeSupport, type CommittedEffectFailureResult } from './confirmedBatchOutcomeSupport';
import { formatSectionRenderReviewSummary } from './formatSectionRenderReviewSummary';
import { projectSectionRenderConfirmation } from './projectSectionRenderConfirmation';
import { requireSectionRenderManualRepair } from './requireSectionRenderManualRepair';
import { type settleAgentRunWorkLeaseSafely } from './settleAgentRunWorkLeaseSafely';

type ConfirmedBatchResult = Extract<
    Awaited<ReturnType<typeof executeVersionedCommandBatchEnvelope>>,
    {
        status: 'committed' | 'committed-with-warning' | 'executed' | 'executed-with-warning';
    }
>;

type SettleConfirmedBatchOutcomeInput = {
    confirmation: PendingAppActionConfirmation;
    batchResult: ConfirmedBatchResult;
    group: ReturnType<typeof generateGroupId>;
    committedProjectRevision: string;
    trackedLeaseSettlement: ReturnType<typeof settleAgentRunWorkLeaseSafely>;
    budgetPersistenceWarning: string | null;
    canRebindSectionRenderArtifacts: boolean;
    retainCommittedPendingActionResources: (confirmationId: string) => Promise<void>;
};

export async function settleConfirmedBatchOutcome(
    input: SettleConfirmedBatchOutcomeInput
): Promise<{ status: 'executed' } | CommittedEffectFailureResult> {
    const {
        confirmation,
        batchResult,
        group,
        committedProjectRevision,
        trackedLeaseSettlement,
        budgetPersistenceWarning,
        canRebindSectionRenderArtifacts,
        retainCommittedPendingActionResources,
    } = input;
    const executionKind =
        batchResult.status === 'executed' || batchResult.status === 'executed-with-warning' ? 'runtime' : 'project';
    const receiptPersistenceWarning = confirmedBatchOutcomeSupport.recordTrackedAgentRunReceipt(
        confirmation,
        batchResult.receipt,
        {
            ...(executionKind === 'project' ? { revertGroupId: group.groupId } : {}),
            completesRun: trackedLeaseSettlement.accepted,
            committedRevision: committedProjectRevision,
        }
    );
    const effectsPending =
        batchResult.receipt.outcome === 'partially-committed' && batchResult.receipt.pendingEffects.length > 0;
    const effectsPendingReason = batchResult.receipt.warnings[0] ?? batchResult.receipt.modelSummary;
    const runPersistenceWarning = [
        receiptPersistenceWarning.warning,
        trackedLeaseSettlement.warning,
        budgetPersistenceWarning,
    ]
        .filter(Boolean)
        .join(' ');
    await retainCommittedPendingActionResources(confirmation.id);
    const approvalLabelsByCommandId = confirmedBatchOutcomeSupport.getApprovalLabelsByCommandId(confirmation);
    const unprojectedExecutedLabels: PendingActionExecution[] = batchResult.actions.map(
        ({ action, label, receipt }, index) => {
            const approvedLabel = receipt ? approvalLabelsByCommandId.get(receipt.commandId) : undefined;
            return {
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
        }
    );
    const executionProjection = projectSectionRenderConfirmation({
        confirmation,
        executions: unprojectedExecutedLabels,
        expectedSourceRevision: committedProjectRevision,
    });
    const executedLabels = executionProjection.executions;
    const executionReceipt = executionProjection.receipt;
    let warning: string | undefined;
    if (batchResult.status === 'committed-with-warning' || batchResult.status === 'executed-with-warning') {
        warning = batchResult.warning;
    }
    if (runPersistenceWarning) {
        warning = [warning, runPersistenceWarning].filter(Boolean).join(' ');
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
            effectsPending
                ? `Committed with pending external effects: ${confirmation.prompt}`
                : `Confirmed: ${confirmation.prompt}`,
            executedLabels.map((entry) => entry.actionType)
        );
        updatePendingActionConfirmationStatus({
            confirmationId: confirmation.id,
            status: effectsPending ? 'failed' : 'executed',
            ...(warning ? { error: warning } : {}),
        });
        const sectionRenderProjection = projectSectionRenderConfirmation({
            confirmation,
            expectedSourceRevision: committedProjectRevision,
        });
        const { incompleteSectionRenders, reviewRequiredSectionRenders } = sectionRenderProjection;
        const freshConfirmation = getPendingActionConfirmation(confirmation.id) ?? confirmation;
        let retryableSectionRenders = false;
        let manualReviewReason: string | null = null;
        let manualReviewPersistenceWarning: string | null = null;
        if (
            batchResult.status === 'committed-with-warning' &&
            (incompleteSectionRenders || reviewRequiredSectionRenders.length > 0)
        ) {
            const renderFollowUpAdmitted =
                admitCommittedSectionRenderRetry({
                    confirmation: freshConfirmation,
                    durableReceipt: batchResult.receipt,
                    phase: 'arming',
                }).status === 'admitted';
            const requiresManualRenderRepair = batchResult.receipt.pendingEffects.some(
                (effect) =>
                    effect.kind === 'external-effect' &&
                    effect.operation === 'renderProjectSections' &&
                    effect.remediation === 'manual-repair' &&
                    effect.state === 'pending'
            );
            if (!canRebindSectionRenderArtifacts) {
                manualReviewReason =
                    'Project changed during the original render, so missing original artifacts cannot be retried safely.';
                manualReviewPersistenceWarning = requireSectionRenderManualRepair({
                    runId: confirmation.runId,
                    batchId: batchResult.receipt.batchId,
                    reason: manualReviewReason,
                });
                const surfacedManualReviewError = [
                    manualReviewReason,
                    manualReviewPersistenceWarning,
                    runPersistenceWarning,
                ]
                    .filter(Boolean)
                    .join(' ');
                updatePendingActionFollowUp({
                    confirmationId: confirmation.id,
                    error: surfacedManualReviewError,
                    projectRevision: null,
                    status: 'failed',
                });
                updatePendingActionConfirmationStatus({
                    confirmationId: confirmation.id,
                    status: manualReviewPersistenceWarning ? 'failed' : 'executed',
                    error: surfacedManualReviewError,
                });
            } else if (requiresManualRenderRepair) {
                manualReviewReason =
                    reviewRequiredSectionRenders.length > 0
                        ? `Section render artifacts require manual review: ${formatSectionRenderReviewSummary(reviewRequiredSectionRenders)}.`
                        : (batchResult.warning ?? 'Section render artifacts require manual repair.');
                manualReviewPersistenceWarning = requireSectionRenderManualRepair({
                    runId: confirmation.runId,
                    batchId: batchResult.receipt.batchId,
                    reason: manualReviewReason,
                });
                const surfacedManualReviewError = [
                    manualReviewReason,
                    manualReviewPersistenceWarning,
                    runPersistenceWarning,
                ]
                    .filter(Boolean)
                    .join(' ');
                updatePendingActionFollowUp({
                    confirmationId: confirmation.id,
                    error: surfacedManualReviewError,
                    projectRevision: null,
                    status: 'failed',
                });
                updatePendingActionConfirmationStatus({
                    confirmationId: confirmation.id,
                    status: manualReviewPersistenceWarning ? 'failed' : 'executed',
                    error: surfacedManualReviewError,
                });
            } else if (renderFollowUpAdmitted && incompleteSectionRenders) {
                retryableSectionRenders = true;
                updatePendingActionFollowUp({
                    confirmationId: confirmation.id,
                    error: batchResult.warning,
                    projectRevision: committedProjectRevision,
                    status: 'retryable',
                });
            } else if (renderFollowUpAdmitted && reviewRequiredSectionRenders.length > 0) {
                const reviewSummary = formatSectionRenderReviewSummary(reviewRequiredSectionRenders);
                manualReviewReason = `Section render artifacts require manual review: ${reviewSummary}.`;
                manualReviewPersistenceWarning = requireSectionRenderManualRepair({
                    runId: confirmation.runId,
                    batchId: batchResult.receipt.batchId,
                    reason: manualReviewReason,
                });
                const surfacedManualReviewError = [
                    manualReviewReason,
                    manualReviewPersistenceWarning,
                    runPersistenceWarning,
                ]
                    .filter(Boolean)
                    .join(' ');
                updatePendingActionFollowUp({
                    confirmationId: confirmation.id,
                    error: surfacedManualReviewError,
                    projectRevision: committedProjectRevision,
                    status: 'failed',
                });
                updatePendingActionConfirmationStatus({
                    confirmationId: confirmation.id,
                    status: manualReviewPersistenceWarning ? 'failed' : 'executed',
                    error: surfacedManualReviewError,
                });
            }
        }
        let content = `Executed after confirmation:\n\n${executionReceipt}`;
        if (receiptPersistenceWarning.effectsPending) {
            content = `${content}\n\nExternal render or analysis effects remain pending; this run is not complete.`;
        }
        if (batchResult.status === 'committed-with-warning') {
            content = `Applied after confirmation:\n\n${executionReceipt}\n\nThe project change committed with a follow-up warning: ${batchResult.warning}. Do not retry these confirmed actions.`;
            if (retryableSectionRenders) {
                content = `Applied after confirmation:\n\n${executionReceipt}\n\nThe project change committed with a follow-up warning: ${batchResult.warning}. Do not replay the confirmed project actions. Retry missing renders below; only receipt-bound missing artifacts will run.`;
            }
            if (manualReviewReason) {
                content = `Applied after confirmation:\n\n${executionReceipt}\n\nThe project commands were not replayed. ${manualReviewReason}${manualReviewPersistenceWarning ? `\n\n${manualReviewPersistenceWarning}` : ''}`;
            }
        }
        if (effectsPending && !manualReviewReason) {
            const manualRepairRequired = batchResult.receipt.pendingEffects.some(
                ({ remediation }) => remediation === 'manual-repair'
            );
            content = `The project change is durably committed:\n\n${executionReceipt}\n\nAt least one external effect remains pending: ${effectsPendingReason}. ${manualRepairRequired ? 'Use the retained manual-repair guidance' : 'Use the retained pending-effect reconciliation action on the authoritative collaboration host'}; the project mutation will not replay.`;
        }
        if (batchResult.status === 'executed-with-warning') {
            content = `Executed after confirmation:\n\n${executionReceipt}\n\nThe runtime command executed with a follow-up warning: ${batchResult.warning}. Do not retry these confirmed actions.`;
        }
        if (runPersistenceWarning) {
            content = `${content}\n\n${runPersistenceWarning}`;
        }
        let pendingActionFollowUpStatus: 'failed' | 'retryable' | undefined;
        if (manualReviewReason) {
            pendingActionFollowUpStatus = 'failed';
        } else if (retryableSectionRenders) {
            pendingActionFollowUpStatus = 'retryable';
        }
        updateChatMessage(confirmation.assistantMessageId, {
            pendingActionConfirmationStatus:
                (effectsPending && !manualReviewReason) || manualReviewPersistenceWarning ? 'failed' : 'executed',
            pendingActionFollowUpStatus,
            error: manualReviewReason
                ? [manualReviewReason, manualReviewPersistenceWarning, runPersistenceWarning].filter(Boolean).join(' ')
                : warning,
            content,
        });
    } catch (error) {
        const warning = error instanceof Error ? error.message : String(error);
        logger.error(new Error('Confirmed AI action reporting failed after execution', { cause: error }));
        try {
            updatePendingActionConfirmationStatus({
                confirmationId: confirmation.id,
                status: effectsPending ? 'failed' : 'executed',
                error: warning,
            });
            const executionDescription =
                executionKind === 'runtime' ? 'runtime command executed' : 'project change committed';
            updateChatMessage(confirmation.assistantMessageId, {
                pendingActionConfirmationStatus: effectsPending ? 'failed' : 'executed',
                error: warning,
                content: effectsPending
                    ? `The project change is durably committed and external effects remain pending, but reporting also failed: ${warning}. Use the retained reconciliation or manual-repair guidance.\n\n${executionReceipt}`
                    : `The confirmed ${executionDescription}, but reporting it failed: ${warning}. Do not retry these actions.\n\n${executionReceipt}`,
            });
        } catch (reportingError) {
            logger.error(
                new Error('Confirmed AI post-execution warning could not be persisted', {
                    cause: reportingError,
                })
            );
        }
    }
    if (effectsPending) {
        return confirmedBatchOutcomeSupport.createCommittedEffectFailureResult(
            batchResult.receipt,
            effectsPendingReason
        );
    }
    return { status: 'executed' };
}
