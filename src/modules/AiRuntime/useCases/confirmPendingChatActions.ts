import { describeAction, executeAppAction, generateGroupId } from '#/modules/Command/useCases';

import { type ChatActionConfirmationStatus } from '../models/Chat';
import { pushAiActionGroup, type AiActionGroup } from '../stores/aiActionHistoryStore';
import { updateChatMessage } from '../stores/chatStore';
import {
    getPendingActionConfirmation,
    recordPendingActionExecution,
    updatePendingActionConfirmationStatus,
} from '../stores/pendingActionConfirmationStore';

import { notifyAiChange } from './notifyAiChange';

type ConfirmPendingChatActionsInput = {
    confirmationId: string;
};

type ConfirmPendingChatActionsResult =
    | { status: 'missing' }
    | { status: 'not_pending'; currentStatus: ChatActionConfirmationStatus }
    | { status: 'executed' }
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

    updatePendingActionConfirmationStatus({ confirmationId: confirmation.id, status: 'accepted' });
    updateChatMessage(confirmation.assistantMessageId, {
        pendingActionConfirmationStatus: 'accepted',
        content: `Confirming:\n\n${confirmation.actionLabels.map((label) => `- ${label}`).join('\n')}`,
    });

    const group = generateGroupId(confirmation.prompt);
    const executedLabels: Array<{ actionType: string; label: string }> = [];

    try {
        for (const action of confirmation.actions) {
            await executeAppAction(action, { ...group, source: 'prompt' });
            const execution = { actionType: action.type, label: describeAction(action) };
            executedLabels.push(execution);
            recordPendingActionExecution({ confirmationId: confirmation.id, execution });
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
            content: `Failed to execute confirmed actions:\n\n${reason}`,
        });
        return { status: 'failed', reason };
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
        confirmation.actions.map((action) => action.type)
    );

    updatePendingActionConfirmationStatus({ confirmationId: confirmation.id, status: 'executed' });
    updateChatMessage(confirmation.assistantMessageId, {
        pendingActionConfirmationStatus: 'executed',
        content: `Executed after confirmation:\n\n${executedLabels.map((entry) => `- **${entry.actionType}**: ${entry.label}`).join('\n')}`,
    });

    return { status: 'executed' };
}
