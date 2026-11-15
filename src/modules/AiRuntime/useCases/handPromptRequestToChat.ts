import { logger } from '#/infra/logger/appLogger';
import { workspaceStore } from '#/modules/WorkspaceShell/stores';
import { toggleChatPanel } from '#/modules/WorkspaceShell/useCases';

import { type ChatHandOffReason } from '../models/PlanningOutcome';
import { chatStore } from '../stores/chatStore';

import { notifyAiChange } from './notifyAiChange';
import { readChatThreadContext } from './readChatThreadContext';
import { sendChatMessage } from './sendChatMessage';

const HAND_OFF_NOTICES: Record<ChatHandOffReason, string> = {
    brief: 'Opened in the agent chat: this request writes a production brief, which you approve there before any batch it plans.',
    'scheduled-batches':
        'Opened in the agent chat: this request runs as successive batches, each approved there one at a time.',
};

/** Why the chat cannot take the request now, or `null` when it can. */
function describeChatRefusal(): string | null {
    if (chatStore.value?.isGenerating === true) {
        return 'Command not executed: this request runs in the agent chat, which is still working on another request. Try again when it finishes.';
    }
    // A new request beside a waiting card would join or replace it; the user decides that card first.
    if ((readChatThreadContext()?.pendingProposal ?? null) !== null) {
        return 'Command not executed: this request runs in the agent chat, which has a proposal waiting. Confirm or cancel it first.';
    }
    return null;
}

/**
 * Runs a Prompt Bar request in the agent chat, as the chat's own Apply request, when it writes a
 * production brief or runs as successive batches the Prompt Bar cannot approve one at a time. The
 * chat plans it again in its thread and owns its Stop; the Prompt Bar's signal never reaches it.
 *
 * `endPromptRun` ends the Prompt Bar's run before the chat admits its own, so the two never count
 * against the run concurrency limit together.
 */
export function handPromptRequestToChat(input: {
    prompt: string;
    reason: ChatHandOffReason;
    endPromptRun: (phase: 'completed' | 'failed') => void;
}): 'handed-off' | 'refused' {
    const refusal = describeChatRefusal();
    if (refusal !== null) {
        input.endPromptRun('failed');
        notifyAiChange(refusal, []);
        return 'refused';
    }
    input.endPromptRun('completed');
    if (workspaceStore.value?.chatPanelOpen !== true) {
        toggleChatPanel();
    }
    void sendChatMessage(input.prompt, { mode: 'apply' }).catch((error: unknown) => {
        logger.error(new Error('Prompt Bar hand-off to the agent chat failed', { cause: error }));
    });
    notifyAiChange(HAND_OFF_NOTICES[input.reason], []);
    return 'handed-off';
}
