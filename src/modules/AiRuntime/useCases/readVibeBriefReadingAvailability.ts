import { AGENT_RUN_TERMINAL_PHASES } from '../models/AgentRun';
import { type BriefReading } from '../models/BriefReading';
import { type PendingAppActionConfirmation } from '../stores/pendingActionConfirmationStore';

import { agentRunLifecycle } from './agentRunLifecycle';

/**
 * The readings a card offers while choosing one can still plan it: only a pending brief card of a live
 * run, which has not been replaced. Otherwise it offers none, and says why.
 */
export function readVibeBriefReadingAvailability(confirmation: PendingAppActionConfirmation): {
    readings: readonly BriefReading[];
    reason: string | null;
} {
    const offered = confirmation.approvalSnapshot.briefReadings?.readings ?? [];
    if (offered.length === 0) {
        return { readings: [], reason: 'The card offers no reading.' };
    }
    if (confirmation.status !== 'proposed' || confirmation.supersededBy !== null) {
        return { readings: [], reason: `The proposal is already ${confirmation.status}.` };
    }
    const run = agentRunLifecycle.get(confirmation.runId);
    if (run === null || AGENT_RUN_TERMINAL_PHASES.has(run.phase) || run.cancellation.requestedAt !== null) {
        return { readings: [], reason: 'The run this card belongs to has ended.' };
    }
    return { readings: offered, reason: null };
}
