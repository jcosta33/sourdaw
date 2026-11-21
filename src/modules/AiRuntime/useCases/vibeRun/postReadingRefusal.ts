import { appendChatMessage } from '../../stores/chatStore';
import { type PendingAppActionConfirmation } from '../../stores/pendingActionConfirmationStore';

/**
 * Tells the musician why a chosen reading was refused before its card retired. The card, its run and
 * the other readings stay as they were, so this message is the only trace of the refusal.
 */
export function postReadingRefusal(input: {
    confirmation: PendingAppActionConfirmation;
    readingId: string;
    reason: string;
}): void {
    const reading = input.confirmation.approvalSnapshot.briefReadings?.readings.find(
        (candidate) => candidate.id === input.readingId
    );
    const subject = reading === undefined ? 'the chosen reading' : `the reading "${reading.name}"`;
    appendChatMessage({
        id: `msg-${crypto.randomUUID()}`,
        role: 'assistant',
        content: `Could not plan ${subject}: ${input.reason}`,
        timestamp: Date.now(),
        error: input.reason,
    });
}
