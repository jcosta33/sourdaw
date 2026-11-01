import { captureProjectIdentity, projectRevisionMatchesLiveIgnoringSaveWrites } from '#/modules/CrdtDocument/useCases';
import { workspaceStore } from '#/modules/WorkspaceShell/stores';
import { toggleChatPanel } from '#/modules/WorkspaceShell/useCases';

import { appendAnswerChatMessages } from '../agentRequestOrchestration/appendAnswerChatMessages';
import { type AiAnswerNotice } from '../aiChangeNotificationState';

/**
 * `opened` when the answer reached the chat; otherwise why it did not: another project is open
 * (`project-switched`), or the project it answered about has changed since (`project-changed`).
 */
export type OpenAnswerInChatResult = 'opened' | 'project-switched' | 'project-changed';

/**
 * Shows a Prompt Bar answer in full as a chat reply, where its markdown renders and its evidence can
 * be expanded, and opens the chat panel if it is closed.
 *
 * The notice outlives the project it answered about, so the answer is shown only while that project
 * is still open at the revision it was answered against; a command-batch checkpoint or a save
 * alone is not a change. A stale answer is not shown at all, rather than appended to another project's chat or
 * presented as current.
 */
export function openAnswerInChat(answer: AiAnswerNotice): OpenAnswerInChatResult {
    if (captureProjectIdentity() !== answer.projectIdentity) {
        return 'project-switched';
    }
    if (!projectRevisionMatchesLiveIgnoringSaveWrites(answer.projectRevision)) {
        return 'project-changed';
    }
    appendAnswerChatMessages(answer.prompt, answer);
    if (workspaceStore.value?.chatPanelOpen !== true) {
        toggleChatPanel();
    }
    return 'opened';
}
