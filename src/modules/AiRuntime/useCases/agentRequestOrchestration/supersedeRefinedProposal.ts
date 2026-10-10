import { logger } from '#/infra/logger/appLogger';
import { captureProjectIdentity } from '#/modules/CrdtDocument/useCases';

import {
    type PendingAppActionConfirmation,
    getPendingActionConfirmation,
} from '../../stores/pendingActionConfirmationStore';
import { agentRunCancellation } from '../cancelAgentRun';

import { retireSupersededConfirmation } from './retireSupersededConfirmation';

type RefinedProposalAdmission =
    { status: 'admitted'; confirmation: PendingAppActionConfirmation } | { status: 'refused'; reason: string };

const REFINED_REASON = 'Replaced by a refined proposal.';
const REFINED_MESSAGE = 'This proposal was replaced by a refined one. Review and confirm the new proposal instead.';
const ASK_AGAIN = 'Ask again for the change you want, relative to the project as it is now.';
const ALREADY_APPLIED_REASON = `The proposal this request refines was already applied, so no refined proposal was made. ${ASK_AGAIN}`;
const NO_LONGER_PENDING_REASON = `The proposal this request refines is no longer pending: it was cancelled, replaced or settled, so no refined proposal was made. ${ASK_AGAIN}`;

const APPLIED_STATUSES: ReadonlySet<PendingAppActionConfirmation['status']> = new Set(['accepted', 'executed']);

/**
 * Whether the card a refinement names can still be replaced, read at the moment the replacement is
 * persisted rather than when the thread was read: planning takes time, and in it the musician may
 * confirm, cancel or re-preview the card, or open another project. Only a card still proposed, not
 * already replaced, and in the open project can be; anything else leaves a second applicable card
 * for the same change, so the refinement persists nothing.
 */
function admitRefinedProposal(confirmationId: string): RefinedProposalAdmission {
    const confirmation = getPendingActionConfirmation(confirmationId);
    if (
        confirmation === null ||
        confirmation.approvalSnapshot.commandBatch?.authority.projectId !== captureProjectIdentity()
    ) {
        return { status: 'refused', reason: NO_LONGER_PENDING_REASON };
    }
    if (APPLIED_STATUSES.has(confirmation.status)) {
        return { status: 'refused', reason: ALREADY_APPLIED_REASON };
    }
    if (confirmation.status !== 'proposed' || confirmation.supersededBy !== null) {
        return { status: 'refused', reason: NO_LONGER_PENDING_REASON };
    }
    return { status: 'admitted', confirmation };
}

/**
 * Retire the card a persisted refinement replaced, then settle the run it was waiting in: a
 * refined card's run proposed nothing else (a scheduled batch is never refined), so it leaves
 * `waiting-for-approval` cancelled with its batch, exactly as cancelling the card would leave it.
 * The replacement belongs to the request that refined it.
 */
async function retireRefinedProposal(confirmation: PendingAppActionConfirmation, replacementId: string): Promise<void> {
    await retireSupersededConfirmation(confirmation, replacementId, {
        reason: REFINED_REASON,
        content: REFINED_MESSAGE,
    });
    try {
        await agentRunCancellation.cancel({ runId: confirmation.runId, reason: REFINED_REASON });
    } catch (error) {
        // The card is already retired, so its batch can no longer run; a run whose settlement could
        // not be persisted is reported, never allowed to fail the replacement that did persist.
        logger.error(new Error('Refined proposal run settlement could not be persisted', { cause: error }));
    }
}

/** How a refinement takes the place of the pending card it names: admitted where it persists, then retired. */
export const refinedProposalSupersession = {
    admit: admitRefinedProposal,
    retire: retireRefinedProposal,
} as const;
