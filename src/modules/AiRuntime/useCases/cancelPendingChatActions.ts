import { type ChatActionConfirmationStatus } from '../models/Chat';
import { updateChatMessage } from '../stores/chatStore';
import {
    getPendingActionConfirmation,
    settlePendingActionResourceLeaseBestEffort,
    updatePendingActionConfirmationStatus,
} from '../stores/pendingActionConfirmationStore';

import { agentRunCancellation } from './cancelAgentRun';

type CancelPendingChatActionsInput = {
    confirmationId: string;
};

type CancelPendingChatActionsOutput =
    | { status: 'missing' }
    | { status: 'not_pending'; currentStatus: ChatActionConfirmationStatus }
    | { status: 'cancelled' };

export async function cancelPendingChatActions(
    input: CancelPendingChatActionsInput
): Promise<CancelPendingChatActionsOutput> {
    const confirmation = getPendingActionConfirmation(input.confirmationId);
    if (!confirmation) {
        return { status: 'missing' };
    }
    if (confirmation.status !== 'proposed') {
        return { status: 'not_pending', currentStatus: confirmation.status };
    }

    await agentRunCancellation.cancel({
        runId: confirmation.runId,
        reason: 'User cancelled the pending confirmation.',
    });
    updatePendingActionConfirmationStatus({ confirmationId: confirmation.id, status: 'cancelled' });
    await settlePendingActionResourceLeaseBestEffort({
        confirmationId: confirmation.id,
        disposition: 'discard',
    });
    updateChatMessage(confirmation.assistantMessageId, {
        pendingActionConfirmationStatus: 'cancelled',
        content: `Cancelled pending actions:\n\n${confirmation.actionLabels.map((label) => `- ${label}`).join('\n')}`,
    });

    return { status: 'cancelled' };
}
