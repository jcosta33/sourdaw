import { captureProjectIdentity, projectRevisionMatchesLiveIgnoringSaveWrites } from '#/modules/CrdtDocument/useCases';

import { aiBackendPreferenceStore } from '../../stores/aiBackendPreferenceStore';
import { appendChatMessage, chatStore } from '../../stores/chatStore';
import { orchestratePromptChatRequest } from '../agentRequestOrchestration/orchestratePromptChatRequest';

/** What the user asked for, in the words of the control they used. */
const PROPOSE_ANSWER_SUGGESTION_REQUEST = 'Propose this';

/**
 * `requested` when the suggestion went to the planner, whose own refusals reach the chat as any
 * request's do; otherwise why it did not: there is no such offer or a request is already running
 * (`unavailable`), another project is open (`project-switched`), or the project the answer was about
 * has changed since (`project-changed`).
 */
export type ProposeAnswerSuggestionResult = 'requested' | 'unavailable' | 'project-switched' | 'project-changed';

function appendRefusal(reason: string): void {
    appendChatMessage({
        id: `msg-${crypto.randomUUID()}`,
        role: 'user',
        content: PROPOSE_ANSWER_SUGGESTION_REQUEST,
        timestamp: Date.now(),
    });
    appendChatMessage({
        id: `msg-${crypto.randomUUID()}`,
        role: 'assistant',
        content: `Command not executed: ${reason}`,
        timestamp: Date.now(),
        error: reason,
    });
}

/**
 * Prepares the suggestion a chat answer offered as an ordinary proposal for approval. The answer
 * described the recipe against one project at one revision, so the offer is taken up only while that
 * project is still open at that revision (a command-batch checkpoint or a save alone is not a
 * change); otherwise nothing is planned and the chat says why. The planner then compiles the recipe
 * itself, never asking a provider for values, and the batch crosses the same validation, state guards,
 * production brief and pending-confirmation path every application-compiled batch does.
 */
export async function proposeAnswerSuggestion(messageId: string): Promise<ProposeAnswerSuggestionResult> {
    const state = chatStore.value;
    const message = state?.messages.find((candidate) => candidate.id === messageId);
    const suggestion = message?.answerSuggestion;
    if (!state || state.isGenerating || message === undefined || suggestion === undefined) {
        return 'unavailable';
    }
    if (captureProjectIdentity() !== message.projectId) {
        appendRefusal('This answer was about another project, so its suggestion cannot be proposed here.');
        return 'project-switched';
    }
    if (
        message.projectRevision === undefined ||
        !projectRevisionMatchesLiveIgnoringSaveWrites(message.projectRevision)
    ) {
        appendRefusal(
            'The project has changed since this answer, so its suggestion may no longer fit. Ask again for a current one.'
        );
        return 'project-changed';
    }
    await orchestratePromptChatRequest({
        userText: PROPOSE_ANSWER_SUGGESTION_REQUEST,
        requestedRoute: aiBackendPreferenceStore.value ?? 'auto',
        backend: 'none',
        interactionMode: 'apply',
        options: { suggestion },
    });
    return 'requested';
}
