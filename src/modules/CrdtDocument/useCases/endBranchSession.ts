import {
    branchStateAuthority,
    type BranchSessionEndOutcome,
    type BranchSessionHandle,
} from '../repositories/branchStateAuthority';

/**
 * Put the pre-session branch list back and release the durable list.
 *
 * Reports rather than throws: callers run this during teardown, where the steps
 * after it — closing peer connections, stopping the sync — must happen
 * regardless. The outcomes are not interchangeable. `restored` and `superseded`
 * are both terminal; the rest mean the session record is still durable and the
 * call has to be retried or the next boot will recover it.
 */
export function endBranchSession(handle: BranchSessionHandle): Promise<BranchSessionEndOutcome> {
    return branchStateAuthority.endSession(handle);
}
