import { type ThreadContext } from '../models/ThreadContext';
import { agentRunStore } from '../stores/agentRunStore';
import { aiActionHistoryStore } from '../stores/aiActionHistoryStore';
import { chatStore } from '../stores/chatStore';
import { pendingActionConfirmationStore } from '../stores/pendingActionConfirmationStore';
import { buildThreadContext } from '../transformers/buildThreadContext';

/**
 * The chat thread's state for the request about to be planned: read before the request joins the
 * thread, so it holds only what came before it.
 */
export function readChatThreadContext(): ThreadContext | null {
    return buildThreadContext({
        messages: chatStore.value?.messages ?? [],
        confirmations: pendingActionConfirmationStore.value?.confirmations ?? [],
        runs: agentRunStore.value?.runs ?? [],
        actionGroups: aiActionHistoryStore.value?.groups ?? [],
    });
}
