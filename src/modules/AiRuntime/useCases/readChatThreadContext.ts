import { undoHistoryStore } from '#/modules/Command/stores';
import { captureProjectIdentity } from '#/modules/CrdtDocument/useCases';

import { type ThreadContext } from '../models/ThreadContext';
import { agentRunStore } from '../stores/agentRunStore';
import { aiActionHistoryStore } from '../stores/aiActionHistoryStore';
import { chatStore } from '../stores/chatStore';
import { pendingActionConfirmationStore } from '../stores/pendingActionConfirmationStore';
import { buildThreadContext } from '../transformers/buildThreadContext';

function groupIdsOf(entries: ReadonlyArray<{ groupId?: string }>): ReadonlySet<string> {
    return new Set(entries.flatMap((entry) => (entry.groupId === undefined ? [] : [entry.groupId])));
}

/**
 * The chat thread's state for the request about to be planned: read before the request joins the
 * thread, so it holds only what came before it, and only for the open project. A commit's standing
 * is read from where the undo history holds its group: applied in `past`, undone in `future`.
 */
export function readChatThreadContext(): ThreadContext | null {
    const history = undoHistoryStore.value;
    return buildThreadContext({
        messages: chatStore.value?.messages ?? [],
        confirmations: pendingActionConfirmationStore.value?.confirmations ?? [],
        runs: agentRunStore.value?.runs ?? [],
        actionGroups: aiActionHistoryStore.value?.groups ?? [],
        projectId: captureProjectIdentity(),
        pastGroupIds: groupIdsOf(history?.past ?? []),
        futureGroupIds: groupIdsOf(history?.future ?? []),
    });
}
