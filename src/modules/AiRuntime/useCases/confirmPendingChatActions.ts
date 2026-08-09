import { logger } from '#/infra/logger/appLogger';
import { executeAppActionBatch, generateGroupId } from '#/modules/Command/useCases';
import { captureProjectRevision } from '#/modules/CrdtDocument/useCases';

import { AiProposalInvalidatedError } from '../errors/AiProposalInvalidatedError';
import { type ChatActionConfirmationStatus } from '../models/Chat';
import { pushAiActionGroup, type AiActionGroup } from '../stores/aiActionHistoryStore';
import { chatStore, setActiveAborter, setChatGenerating, updateChatMessage } from '../stores/chatStore';
import {
    getPendingActionConfirmation,
    recordPendingActionExecution,
    type PendingActionExecution,
    type PendingAppActionConfirmation,
    updatePendingActionConfirmationStatus,
} from '../stores/pendingActionConfirmationStore';

import { getPlannedActionAffectedIds } from './getPlannedActionAffectedIds';
import { notifyAiChange } from './notifyAiChange';

type ConfirmPendingChatActionsInput = {
    confirmationId: string;
};

type ConfirmPendingChatActionsResult =
    | { status: 'missing' }
    | { status: 'not_pending'; currentStatus: ChatActionConfirmationStatus }
    | { status: 'busy' }
    | { status: 'executed' }
    | { status: 'invalidated'; reason: string }
    | { status: 'cancelled' }
    | { status: 'failed'; reason: string };

type ConfirmPendingChatActionsOutput = Promise<ConfirmPendingChatActionsResult>;

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
    const protectedAffectedIds = getProtectedAffectedIds(confirmation.actions, approved.protectedUnchanged);
    if (protectedAffectedIds.length > 0) {
        return `The executable action batch targets protected IDs: ${protectedAffectedIds.join(', ')}.`;
    }

    const currentApproval = JSON.stringify({
        actions: confirmation.actions,
        actionLabels: confirmation.actionLabels,
        protectedUnchanged: confirmation.protectedUnchanged,
    });
    if (currentApproval !== JSON.stringify(approved)) {
        return 'The executable action batch no longer matches the approved proposal.';
    }

    const approvedProtectedAffectedIds = getProtectedAffectedIds(approved.actions, approved.protectedUnchanged);
    if (approvedProtectedAffectedIds.length > 0) {
        return `The approved action batch targets protected IDs: ${approvedProtectedAffectedIds.join(', ')}.`;
    }

    return null;
}

function formatExecutionReceipt(
    executions: readonly PendingActionExecution[],
    confirmation: PendingAppActionConfirmation
): string {
    const executedActions = executions
        .map((execution) => {
            const affectedIds = execution.affectedIds.length > 0 ? execution.affectedIds.join(', ') : 'none';
            return `- **${execution.actionType}**: ${execution.label}\n  - Affected IDs: ${affectedIds}\n  - Outcome: ${execution.outcome}`;
        })
        .join('\n');
    const protectedAffectedIds = new Set(executions.flatMap((execution) => execution.affectedIds));
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

export async function confirmPendingChatActions(
    input: ConfirmPendingChatActionsInput
): ConfirmPendingChatActionsOutput {
    const confirmation = getPendingActionConfirmation(input.confirmationId);
    if (!confirmation) {
        return { status: 'missing' };
    }
    if (confirmation.status !== 'proposed') {
        return { status: 'not_pending', currentStatus: confirmation.status };
    }

    if (captureProjectRevision() !== confirmation.projectRevision) {
        return invalidatePendingConfirmation(confirmation);
    }

    if (chatStore.value?.isGenerating === true) {
        updateChatMessage(confirmation.assistantMessageId, {
            pendingActionConfirmationStatus: 'proposed',
            content: `Another AI command is still running. This proposal remains pending:\n\n${confirmation.actionLabels.map((label) => `- ${label}`).join('\n')}`,
        });
        return { status: 'busy' };
    }

    const approvalPreflightFailure = getApprovalPreflightFailure(confirmation);
    if (approvalPreflightFailure) {
        return failApprovalPreflight(confirmation, approvalPreflightFailure);
    }

    updatePendingActionConfirmationStatus({ confirmationId: confirmation.id, status: 'accepted' });
    updateChatMessage(confirmation.assistantMessageId, {
        pendingActionConfirmationStatus: 'accepted',
        content: `Confirming:\n\n${confirmation.actionLabels.map((label) => `- ${label}`).join('\n')}`,
    });

    const group = generateGroupId(confirmation.prompt);
    const aborter = new AbortController();
    setChatGenerating(true);
    setActiveAborter(aborter);
    let batchResult: Awaited<ReturnType<typeof executeAppActionBatch>>;
    try {
        batchResult = await executeAppActionBatch(confirmation.approvalSnapshot.actions, {
            ...group,
            source: 'prompt',
            requireCompensation: confirmation.executionMode === 'atomic',
            shouldExecute: () => !aborter.signal.aborted && captureProjectRevision() === confirmation.projectRevision,
        });
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
        return { status: 'failed', reason };
    } finally {
        setActiveAborter(null);
        setChatGenerating(false);
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
        let executionKind: 'project' | 'runtime' = 'project';
        if (batchResult.status === 'executed' || batchResult.status === 'executed-with-warning') {
            executionKind = 'runtime';
        }
        const executedLabels = batchResult.actions.map(({ action, label }, index) => ({
            actionType: action.type,
            label: confirmation.approvalSnapshot.actionLabels[index] ?? label,
            executionKind,
            affectedIds: getPlannedActionAffectedIds(action),
            outcome: batchResult.status,
        }));
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
            let content = `Executed after confirmation:\n\n${executionReceipt}`;
            if (batchResult.status === 'committed-with-warning') {
                content = `Applied after confirmation:\n\n${executionReceipt}\n\nThe project change committed with a follow-up warning: ${batchResult.warning}. Do not retry these confirmed actions.`;
            }
            if (batchResult.status === 'executed-with-warning') {
                content = `Executed after confirmation:\n\n${executionReceipt}\n\nThe runtime command executed with a follow-up warning: ${batchResult.warning}. Do not retry these confirmed actions.`;
            }
            updateChatMessage(confirmation.assistantMessageId, {
                pendingActionConfirmationStatus: 'executed',
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
        updatePendingActionConfirmationStatus({ confirmationId: confirmation.id, status: 'executed' });
        updateChatMessage(confirmation.assistantMessageId, {
            pendingActionConfirmationStatus: 'executed',
            content: 'No project changes were needed after confirmation.',
        });
        return { status: 'executed' };
    }

    if (batchResult.status === 'ambiguous') {
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
    return { status: 'failed', reason };
}

function invalidatePendingConfirmation(confirmation: PendingAppActionConfirmation): ConfirmPendingChatActionsResult {
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
    return { status: 'invalidated', reason };
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
    return { status: 'cancelled' };
}
