import { AGENT_RUN_TERMINAL_PHASES } from '../models/AgentRun';
import { type ChatActionConfirmationStatus } from '../models/Chat';
import { updateChatMessage } from '../stores/chatStore';
import {
    getPendingActionConfirmation,
    settlePendingActionResourceLease,
    updatePendingActionConfirmationStatus,
} from '../stores/pendingActionConfirmationStore';

import { proposeNextScheduledBatch } from './agentRequestOrchestration/proposeNextScheduledBatch';
import { readConfirmationBatchId } from './agentRequestOrchestration/readConfirmationBatchId';
import { agentRunLifecycle } from './agentRunLifecycle';
import { readVibeBatchSkipAvailability } from './readVibeBatchSkipAvailability';
import { stopMeasuredPreviewAudition } from './stopMeasuredPreviewAudition';

type SkipPendingVibeBatchInput = {
    confirmationId: string;
};

type SkipPendingVibeBatchOutput =
    | { status: 'missing' }
    | { status: 'not_pending'; currentStatus: ChatActionConfirmationStatus }
    | { status: 'refused'; reason: string }
    | { status: 'skipped' };

/**
 * Passes over one pending vibe-run batch and lets the run go on: the batch executes nothing, writes
 * no undo entry and earns no receipt, its card settles cancelled and says it was skipped, and the run
 * returns to where it stands between a committed batch and the next proposal. The next batch is then
 * grounded from the plan against the live project, which lacks the skipped batch, through every guard
 * a batch after a commit crosses; skipping the last batch completes the run and posts its summary.
 */
export async function skipPendingVibeBatch(input: SkipPendingVibeBatchInput): Promise<SkipPendingVibeBatchOutput> {
    void stopMeasuredPreviewAudition({ confirmationId: input.confirmationId });
    const confirmation = getPendingActionConfirmation(input.confirmationId);
    if (!confirmation) {
        return { status: 'missing' };
    }
    if (confirmation.status !== 'proposed') {
        return { status: 'not_pending', currentStatus: confirmation.status };
    }
    const availability = readVibeBatchSkipAvailability(confirmation);
    const batchId = readConfirmationBatchId(confirmation);
    const position = confirmation.approvalSnapshot.batchPosition;
    if (!availability.available || batchId === null || position === undefined) {
        return { status: 'refused', reason: availability.reason ?? 'The batch has no command batch to skip.' };
    }
    // Settled before the lease is released, so a Confirm arriving meanwhile finds nothing pending.
    updatePendingActionConfirmationStatus({ confirmationId: confirmation.id, status: 'cancelled' });
    await settlePendingActionResourceLease({ confirmationId: confirmation.id, disposition: 'discard' });
    const labels = confirmation.actionLabels.map((label) => `- ${label}`).join('\n');
    // A cancellation or project switch while the lease was released ended the run and marked this
    // batch cancelled; the card says so, and the run is left exactly as the cancellation left it.
    const run = agentRunLifecycle.get(confirmation.runId);
    if (run === null || AGENT_RUN_TERMINAL_PHASES.has(run.phase)) {
        updateChatMessage(confirmation.assistantMessageId, {
            pendingActionConfirmationStatus: 'cancelled',
            content: `Cancelled pending actions:\n\n${labels}\n\nThe run ended before this batch could be skipped.`,
        });
        return { status: 'refused', reason: 'The run ended before the batch could be skipped.' };
    }
    updateChatMessage(confirmation.assistantMessageId, {
        pendingActionConfirmationStatus: 'cancelled',
        content: `Skipped batch ${String(position.index)} of ${String(position.total)}:\n\n${labels}`,
    });
    agentRunLifecycle.updateBatchStatus({ runId: confirmation.runId, batchId, status: 'skipped' });
    agentRunLifecycle.transitionPhase({ runId: confirmation.runId, phase: 'executing' });
    if (position.index >= position.total) {
        agentRunLifecycle.transitionPhase({ runId: confirmation.runId, phase: 'completed' });
    }
    await proposeNextScheduledBatch({ runId: confirmation.runId });
    return { status: 'skipped' };
}
