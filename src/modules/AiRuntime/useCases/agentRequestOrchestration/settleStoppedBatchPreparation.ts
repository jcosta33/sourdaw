import { type AgentRun } from '../../models/AgentRun';
import { updateChatMessage } from '../../stores/chatStore';

import { describeAppliedBatches } from './describeAppliedBatches';
import { readSkippedVibeBatchPositions } from './readSkippedVibeBatchPositions';

/**
 * The final line of a batch message whose measured preview stopped rendering: no Stop and no progress
 * survive it, and it says whether the run was cancelled or the preparation stopped on its own, and
 * which batches stay applied.
 */
export function settleStoppedBatchPreparation(
    assistantMessageId: string,
    position: number,
    total: number,
    current: AgentRun | null
): void {
    const cancelled = current !== null && current.cancellation.requestedAt !== null;
    updateChatMessage(assistantMessageId, {
        pendingActionConfirmationStatus: cancelled ? 'cancelled' : undefined,
        stoppableRunId: undefined,
        content: `${cancelled ? 'Cancelled' : 'Stopped'} preparation of batch ${String(position)} of ${String(total)}. ${describeAppliedBatches(position, readSkippedVibeBatchPositions(current))}`,
    });
}
