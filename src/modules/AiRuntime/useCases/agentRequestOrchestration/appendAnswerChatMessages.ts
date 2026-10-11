import { type AnswerEvidenceEntry } from '../../models/PlanningOutcome';
import { appendChatMessage } from '../../stores/chatStore';

/**
 * An answer in the chat is an ordinary reply: the request, then the answer with no error, no
 * pending confirmation, and the receipts it rests on. The agent chat and the Prompt Bar's "Open in
 * chat" both show it through here, so the two never render the same answer differently.
 */
export function appendAnswerChatMessages(
    userText: string,
    answer: { text: string; evidence: readonly AnswerEvidenceEntry[] }
): void {
    appendChatMessage({
        id: `msg-${crypto.randomUUID()}`,
        role: 'user',
        content: userText,
        timestamp: Date.now(),
    });
    appendChatMessage({
        id: `msg-${crypto.randomUUID()}`,
        role: 'assistant',
        content: answer.text,
        timestamp: Date.now(),
        answerEvidence: answer.evidence,
    });
}
