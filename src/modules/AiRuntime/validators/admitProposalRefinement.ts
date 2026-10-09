import { type ThreadContext } from '../models/ThreadContext';

type ProposalRefinementAdmission =
    { status: 'none' } | { status: 'refines'; confirmationId: string } | { status: 'refused'; reason: string };

const NO_PENDING_PROPOSAL_REASON =
    'refines names a pending proposal, but this request has no pending proposal in thread_context to refine; propose without refines.';
const OTHER_PROPOSAL_REASON =
    'refines must be the confirmation id of the pending proposal in thread_context; leave it out for a request that does not refine that proposal.';
const SCHEDULED_PROPOSAL_REASON =
    'The pending proposal is one batch of a multi-batch schedule, and replacing it would drop the batches after it; propose without refines.';

/**
 * Whether a proposal's `refines` binds it to the pending proposal of the thread it was planned in.
 * It must name that proposal's confirmation id exactly; a request from outside a thread, or with
 * nothing pending, has nothing to refine, and a batch of a multi-batch schedule cannot be replaced
 * without dropping the batches still owed after it.
 */
export function admitProposalRefinement(
    refines: unknown,
    thread: ThreadContext | null | undefined
): ProposalRefinementAdmission {
    if (refines === undefined) {
        return { status: 'none' };
    }
    const pending = thread?.pendingProposal ?? null;
    if (pending === null) {
        return { status: 'refused', reason: NO_PENDING_PROPOSAL_REASON };
    }
    if (refines !== pending.confirmationId) {
        return { status: 'refused', reason: OTHER_PROPOSAL_REASON };
    }
    if (pending.batchPosition !== null) {
        return { status: 'refused', reason: SCHEDULED_PROPOSAL_REASON };
    }
    return { status: 'refines', confirmationId: pending.confirmationId };
}
