import { AGENT_RUN_TERMINAL_PHASES } from '../models/AgentRun';
import { type PendingAppActionConfirmation } from '../stores/pendingActionConfirmationStore';

import { agentRunLifecycle } from './agentRunLifecycle';

/** The batches after the brief, which holds position 1 of its run. */
const FIRST_BATCH_POSITION = 2;

/**
 * Whether the user may skip this card and let its run go on: only a pending batch after the brief
 * of a live vibe run, whose batches are each grounded from the plan against the live project. The
 * brief is what the batches rest on, and a later bulk-set slice rebases on the members its earlier
 * slices carried, so neither can be passed over.
 */
export function readVibeBatchSkipAvailability(confirmation: PendingAppActionConfirmation): {
    available: boolean;
    reason: string | null;
} {
    if (confirmation.status !== 'proposed' || confirmation.supersededBy !== null) {
        return { available: false, reason: `The proposal is already ${confirmation.status}.` };
    }
    if ((confirmation.approvalSnapshot.batchPosition?.index ?? 1) < FIRST_BATCH_POSITION) {
        return { available: false, reason: 'Only a batch that follows a run’s first proposal can be skipped.' };
    }
    const run = agentRunLifecycle.get(confirmation.runId);
    if (run === null || AGENT_RUN_TERMINAL_PHASES.has(run.phase)) {
        return { available: false, reason: 'The run this batch belongs to has ended.' };
    }
    if (run.plan?.batchSchedule?.kind !== 'vibe-run') {
        return {
            available: false,
            reason: 'Only a batch of a vibe run can be skipped; a later batch of a bulk set builds on the batches before it.',
        };
    }
    return { available: true, reason: null };
}
