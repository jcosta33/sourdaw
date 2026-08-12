import { type ChatActionConfirmationStatus } from '../models/Chat';
import { updateChatMessage } from '../stores/chatStore';
import {
    getPendingActionConfirmation,
    settlePendingActionResourceLease,
    updatePendingActionConfirmationStatus,
} from '../stores/pendingActionConfirmationStore';

type CancelPendingChatActionsInput = {
    confirmationId: string;
};

type CancelPendingChatActionsOutput =
    | { status: 'missing' }
    | { status: 'not_pending'; currentStatus: ChatActionConfirmationStatus }
    | { status: 'cancelled' };

export function cancelPendingChatActions(input: CancelPendingChatActionsInput): CancelPendingChatActionsOutput {
    const confirmation = getPendingActionConfirmation(input.confirmationId);
    if (!confirmation) {
        return { status: 'missing' };
    }
    if (confirmation.status !== 'proposed') {
        return { status: 'not_pending', currentStatus: confirmation.status };
    }

    updatePendingActionConfirmationStatus({ confirmationId: confirmation.id, status: 'cancelled' });
    settlePendingActionResourceLease({ confirmationId: confirmation.id, disposition: 'discard' });
    updateChatMessage(confirmation.assistantMessageId, {
        pendingActionConfirmationStatus: 'cancelled',
        content: `Cancelled pending actions:\n\n${confirmation.actionLabels.map((label) => `- ${label}`).join('\n')}`,
    });

    return { status: 'cancelled' };
}
