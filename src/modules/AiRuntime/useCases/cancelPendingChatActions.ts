import { type ChatActionConfirmationStatus } from '../models/Chat';
import { updateChatMessage } from '../stores/chatStore';
import {
    getPendingActionConfirmation,
    settlePendingActionResourceLease,
    updatePendingActionConfirmationStatus,
} from '../stores/pendingActionConfirmationStore';

import { agentRunLifecycle } from './agentRunLifecycle';
import { agentRunCancellation } from './cancelAgentRun';

type CancelPendingChatActionsInput = {
    confirmationId: string;
};

type CancelPendingChatActionsOutput =
    | { status: 'missing' }
    | { status: 'not_pending'; currentStatus: ChatActionConfirmationStatus }
    | { status: 'cancelled' }
    | { status: 'cleanup-pending' };

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

    const run = agentRunLifecycle.get(confirmation.runId);
    if (run?.phase === 'cancelled' || run?.phase === 'partially-completed') {
        // A failed write can leave live terminal state ahead of durable state.
        // Persist that exact run before the cancellation owner retries cleanup.
        agentRunLifecycle.retryPersistence(confirmation.runId);
    }
    const cancellation = await agentRunCancellation.cancel({
        runId: confirmation.runId,
        reason: 'User cancelled the pending confirmation.',
    });
    if (cancellation.status === 'missing') {
        return { status: 'missing' };
    }
    if (
        cancellation.status === 'already-terminal' &&
        !['cancelled', 'partially-completed'].includes(cancellation.phase)
    ) {
        throw new Error(`Agent run did not cancel: ${confirmation.runId} (${cancellation.phase})`);
    }
    if (cancellation.status === 'cancelled' && cancellation.cleanupPendingAssetIds.length > 0) {
        return { status: 'cleanup-pending' };
    }
    await settlePendingActionResourceLease({
        confirmationId: confirmation.id,
        disposition: 'discard',
    });
    updatePendingActionConfirmationStatus({ confirmationId: confirmation.id, status: 'cancelled' });
    updateChatMessage(confirmation.assistantMessageId, {
        pendingActionConfirmationStatus: 'cancelled',
        content: `Cancelled pending actions:\n\n${confirmation.actionLabels.map((label) => `- ${label}`).join('\n')}`,
    });

    return { status: 'cancelled' };
}
