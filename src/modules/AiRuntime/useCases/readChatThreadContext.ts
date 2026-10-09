import { undoHistoryStore } from '#/modules/Command/stores';
import { captureProjectIdentity } from '#/modules/CrdtDocument/useCases';

import { type ThreadContext } from '../models/ThreadContext';
import { agentRunStore } from '../stores/agentRunStore';
import { aiActionHistoryStore } from '../stores/aiActionHistoryStore';
import { chatStore } from '../stores/chatStore';
import { pendingActionConfirmationStore } from '../stores/pendingActionConfirmationStore';
import { buildThreadContext } from '../transformers/buildThreadContext';

/**
 * The chat thread's state for the request about to be planned: read before the request joins the
 * thread, so it holds only what came before it, and only for the open project. A commit whose
 * group the undo history holds to redo reads as undone, so an ordinary undo retires it exactly as
 * a revert does.
 */
export function readChatThreadContext(): ThreadContext | null {
    const undoneGroupIds = new Set(
        (undoHistoryStore.value?.future ?? []).flatMap((entry) => (entry.groupId === undefined ? [] : [entry.groupId]))
    );
    return buildThreadContext({
        messages: chatStore.value?.messages ?? [],
        confirmations: pendingActionConfirmationStore.value?.confirmations ?? [],
        runs: agentRunStore.value?.runs ?? [],
        actionGroups: aiActionHistoryStore.value?.groups ?? [],
        projectId: captureProjectIdentity(),
        undoneGroupIds,
    });
}
