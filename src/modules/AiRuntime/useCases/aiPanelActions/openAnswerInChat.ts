import { workspaceStore } from '#/modules/WorkspaceShell/stores';
import { toggleChatPanel } from '#/modules/WorkspaceShell/useCases';

import { appendAnswerChatMessages } from '../agentRequestOrchestration/appendAnswerChatMessages';
import { type AiAnswerNotice } from '../aiChangeNotificationState';

/**
 * Shows a Prompt Bar answer in full as a chat reply, where its markdown renders and its evidence can
 * be expanded, and opens the chat panel if it is closed.
 */
export function openAnswerInChat(answer: AiAnswerNotice): void {
    appendAnswerChatMessages(answer.prompt, answer);
    if (workspaceStore.value?.chatPanelOpen !== true) {
        toggleChatPanel();
    }
}
