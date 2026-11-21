import { AGENT_RUN_TERMINAL_PHASES } from '../../models/AgentRun';
import { chatStore, updateChatMessage } from '../../stores/chatStore';
import { type PendingAppActionConfirmation } from '../../stores/pendingActionConfirmationStore';
import { agentRunLifecycle } from '../agentRunLifecycle';
import { cancelPendingChatActions } from '../cancelPendingChatActions';
import { type getProjectContext } from '../getProjectContext';
import { type prepareMetricGoalPreview } from '../prepareMetricGoalPreview';

import { describeBatchPreviewProgress } from './describeBatchPreviewProgress';
import { settleStoppedBatchPreparation } from './settleStoppedBatchPreparation';

type RePreviewWatch = {
    onBegin: Parameters<typeof prepareMetricGoalPreview>[0]['onBegin'];
    onProgress: Parameters<typeof prepareMetricGoalPreview>[0]['onProgress'];
    settle: () => Promise<void>;
};

/** Hands a re-previewed card back to the live run: no Stop, and the content it showed before the progress lines. */
function restoreRePreviewedCard(messageId: string, cardContent: string | undefined): void {
    if (cardContent === undefined) {
        updateChatMessage(messageId, { stoppableRunId: undefined });
        return;
    }
    updateChatMessage(messageId, { stoppableRunId: undefined, content: cardContent });
}

/**
 * A vibe-run batch card re-previews as its scheduled preview rendered: while the preview renders, the
 * card's message carries the same progress line and a Stop that cancels the run, which ends the
 * measurement. Every exit takes both off again. A run still live gets the card's own text back. A run
 * Stop or anything else ended meanwhile keeps no proposed card: a cancelled run's card is cancelled
 * as its own Cancel would, releasing what it held, and the message ends on the line a stopped batch
 * preparation ends on. The watch takes the card only once this re-preview holds the run's one preview
 * (`onBegin`): a re-preview refused beside another that is still rendering leaves that one's line and
 * Stop as they are, and returns its refusal.
 */
export function watchVibeBatchRePreview(
    confirmation: PendingAppActionConfirmation,
    context: ReturnType<typeof getProjectContext>
): RePreviewWatch {
    const run = agentRunLifecycle.get(confirmation.runId);
    const position = confirmation.approvalSnapshot.batchPosition;
    if (run?.plan?.batchSchedule?.kind !== 'vibe-run' || !position) {
        return { onBegin: undefined, onProgress: undefined, settle: () => Promise.resolve() };
    }
    const messageId = confirmation.assistantMessageId;
    let begun = false;
    let cardContent: string | undefined;
    return {
        onBegin: () => {
            begun = true;
            cardContent = chatStore.value?.messages.find((message) => message.id === messageId)?.content;
            updateChatMessage(messageId, { stoppableRunId: run.runId });
        },
        onProgress: (progress) =>
            updateChatMessage(messageId, {
                content: describeBatchPreviewProgress({
                    context,
                    position: position.index,
                    total: position.total,
                    progress,
                }),
            }),
        settle: async () => {
            if (!begun) {
                return;
            }
            const current = agentRunLifecycle.get(run.runId);
            if (current !== null && !AGENT_RUN_TERMINAL_PHASES.has(current.phase)) {
                restoreRePreviewedCard(messageId, cardContent);
                return;
            }
            if (current?.phase === 'cancelled' || current?.phase === 'partially-completed') {
                await cancelPendingChatActions({ confirmationId: confirmation.id });
            }
            settleStoppedBatchPreparation(messageId, position.index, position.total, agentRunLifecycle.get(run.runId));
        },
    };
}
