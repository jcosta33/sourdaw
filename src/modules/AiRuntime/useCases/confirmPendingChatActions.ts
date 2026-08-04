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
    type PendingAppActionConfirmation,
    updatePendingActionConfirmationStatus,
} from '../stores/pendingActionConfirmationStore';

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
        batchResult = await executeAppActionBatch(confirmation.actions, {
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

    if (batchResult.status === 'committed' || batchResult.status === 'committed-with-warning') {
        const executedLabels = batchResult.actions.map(({ action, label }) => ({
            actionType: action.type,
            label,
        }));
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
            };
            pushAiActionGroup(historyGroup);
            notifyAiChange(
                `Confirmed: ${confirmation.prompt}`,
                executedLabels.map((entry) => entry.actionType)
            );
            updatePendingActionConfirmationStatus({ confirmationId: confirmation.id, status: 'executed' });
            updateChatMessage(confirmation.assistantMessageId, {
                pendingActionConfirmationStatus: 'executed',
                error: batchResult.status === 'committed-with-warning' ? batchResult.warning : undefined,
                content:
                    batchResult.status === 'committed-with-warning'
                        ? `Applied after confirmation:\n\n${executedLabels.map((entry) => `- **${entry.actionType}**: ${entry.label}`).join('\n')}\n\nThe project change committed, but its history record failed: ${batchResult.warning}. Do not retry these confirmed actions.`
                        : `Executed after confirmation:\n\n${executedLabels.map((entry) => `- **${entry.actionType}**: ${entry.label}`).join('\n')}`,
            });
        } catch (error) {
            const warning = error instanceof Error ? error.message : String(error);
            logger.error(new Error('Confirmed AI action reporting failed after commit', { cause: error }));
            try {
                updatePendingActionConfirmationStatus({
                    confirmationId: confirmation.id,
                    status: 'executed',
                    error: warning,
                });
                updateChatMessage(confirmation.assistantMessageId, {
                    pendingActionConfirmationStatus: 'executed',
                    error: warning,
                    content: `The confirmed project change committed, but reporting it failed: ${warning}. Do not retry these actions.`,
                });
            } catch (reportingError) {
                logger.error(
                    new Error('Confirmed AI post-commit warning could not be persisted', {
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
