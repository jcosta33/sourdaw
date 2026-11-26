import { appendChatMessage } from '../../stores/chatStore';

type RePreviewOutcome =
    | { status: 'reproposed' }
    | { status: 'missing' }
    | { status: 'not_pending'; currentStatus: string }
    | { status: 'rejected' | 'conflicted'; reason: string };

function describeRefusal(outcome: RePreviewOutcome): string | null {
    if (outcome.status === 'reproposed') {
        return null;
    }
    if (outcome.status === 'missing') {
        return 'This proposal is no longer recorded.';
    }
    if (outcome.status === 'not_pending') {
        return `This proposal is already ${outcome.currentStatus}.`;
    }
    return outcome.reason;
}

/** A re-preview that cannot replace its card says why in the chat, whichever surface asked. */
export function reportRePreviewRefusal(outcome: RePreviewOutcome): void {
    const reason = describeRefusal(outcome);
    if (reason === null) {
        return;
    }
    appendChatMessage({
        id: `msg-${crypto.randomUUID()}`,
        role: 'assistant',
        content: `Re-preview refused: ${reason}`,
        timestamp: Date.now(),
        error: reason,
    });
}
