import { captureProjectIdentity } from '#/modules/CrdtDocument/useCases';

import { type ChatMessage } from '../../models/Chat';
import { appendChatMessage, chatStore } from '../../stores/chatStore';
import { agentRunLifecycle } from '../agentRunLifecycle';
import { getProjectContext } from '../getProjectContext';
import { describeVibeRunSummary } from '../vibeRun/describeVibeRunSummary';

import { readVibeRunBatchSummaries } from './readVibeRunBatchSummaries';

/** One summary per run: its id is derived from the run, so a second trigger finds it and posts nothing. */
function vibeRunSummaryMessageId(runId: string): string {
    return `vibe-run-summary-${runId}`;
}

/**
 * Posts the one summary a vibe run ends with — when its last batch commits or is skipped, when the
 * user stops it at a batch card, or when a later batch is refused before it is proposed — listing
 * every planned batch's outcome. A summary that offers to revert the run carries its run id.
 */
export function postVibeRunSummary(input: { runId: string; refused?: { position: number; reason: string } }): void {
    const messageId = vibeRunSummaryMessageId(input.runId);
    const messages = chatStore.value?.messages;
    if (messages === undefined || messages.some((message) => message.id === messageId)) {
        return;
    }
    const run = agentRunLifecycle.get(input.runId);
    const batches = run === null ? null : readVibeRunBatchSummaries(run, input.refused);
    if (run === null || batches === null) {
        return;
    }
    const applied = batches.some((summary) => summary.outcome.kind === 'applied');
    const message: ChatMessage = {
        id: messageId,
        role: 'assistant',
        content: describeVibeRunSummary({ batches, context: getProjectContext() }),
        timestamp: Date.now(),
        isCommandAction: true,
        agentRunId: run.runId,
        projectId: captureProjectIdentity(),
    };
    if (applied) {
        message.vibeRunRevert = { runId: run.runId };
    }
    appendChatMessage(message);
}
