import { type ChatMessage } from '../../models/Chat';
import { type AnswerEvidenceEntry, type AnswerSuggestion } from '../../models/PlanningOutcome';
import { appendChatMessage } from '../../stores/chatStore';

type AnsweredProject = { projectIdentity: string; projectRevision: string };

/**
 * An answer in the chat is an ordinary reply: the request, then the answer with no error, no
 * pending confirmation, and the receipts it rests on. The agent chat and the Prompt Bar's "Open in
 * chat" both show it through here, so the two never render the same answer differently. A reply
 * offering a suggestion records the project and revision it answered about, because the offer is
 * proposed only while both are still the ones open.
 */
export function appendAnswerChatMessages(
    userText: string,
    answer: { text: string; evidence: readonly AnswerEvidenceEntry[]; suggestion?: AnswerSuggestion },
    answered: AnsweredProject
): void {
    appendChatMessage({
        id: `msg-${crypto.randomUUID()}`,
        role: 'user',
        content: userText,
        timestamp: Date.now(),
    });
    const reply: ChatMessage = {
        id: `msg-${crypto.randomUUID()}`,
        role: 'assistant',
        content: answer.text,
        timestamp: Date.now(),
        answerEvidence: answer.evidence,
    };
    if (answer.suggestion === undefined) {
        appendChatMessage(reply);
        return;
    }
    appendChatMessage({
        ...reply,
        answerSuggestion: answer.suggestion,
        projectId: answered.projectIdentity,
        projectRevision: answered.projectRevision,
    });
}
